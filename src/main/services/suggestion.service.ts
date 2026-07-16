// suggestion.service.ts — ghost prompt suggestions for the composer (docs/prompt-suggestion-design.md).
// Mirrors CC 2.1.209's promptSuggestion: after a turn settles, FORK the run's final request — same system
// prompt, same tool schemas, same in-memory transcript, one appended instruction — and ask the same model
// what the user might naturally type next. The byte-identical prefix is the whole cost model: the fork
// reads the prompt cache the run just wrote, so a suggestion costs ~an instruction + one short reply, not
// a full-price context re-send. The result is pushed to the composer as a ghost (conv:suggestion); Tab
// accepts it. Nothing here persists: no transcript, no usage_events, no DB row — a suggestion lives in
// memory until the next turn replaces it or the composer consumes it.
//
// Two-phase flow (P1): every settling agent loop NOTES a snapshot (solo run, coordinator-dispatched expert
// — both via runAgentLoop — and each collab expert wake); the conversation-turn settle point then GENERATES
// from the latest note. In a multi-expert turn the last expert to settle wins — the suggestion speaks from
// the context of whoever just answered the user. A turn with no note (coordinator 'direct' chat) simply
// generates nothing.
import { BrowserWindow } from 'electron'
import { callWithTools, type AgentLlmRequest } from '../agent/llm/anthropic'
import type { AgentMessage, AnyToolSchema } from '../agent/types'
import type { ThinkingParam } from '../llm/types'
import type { ConvSuggestion } from '../ipc/contracts'
import * as convRepo from '../repos/conversation.repo'
import * as settingsService from './settings.service'
import { listPending } from './approval.service'
import { filterSuggestion } from './suggestion-filter'

// CC's instruction verbatim (K3g), retargeted from "Claude Code" to this app's surface. Appended as the
// fork's trailing user turn — the ONLY difference from the run's own last request besides the reply.
const SUGGESTION_INSTRUCTION = '[SUGGESTION MODE: Suggest what the user might naturally type next into this conversation.]'

// CC's V3g threshold, re-anchored for Studio (dogfood 2026-07-16): CC suppresses when the settled turn
// moved >10K uncached tokens — a valid "is the cache warm" proxy THERE because CC's system prompt is
// stable within a session. Studio rebuilds the system every run (memory recall / summary injection), so
// the settled turn's uncached share sits at ~system-size (10K+) every single turn and the raw proxy would
// permanently suppress large roles. What actually prices the fork is whether the cache PIPELINE works at
// all: any cache read on the settled turn proves the fork will read the prefix that very turn just wrote
// (same bytes, minutes old). So: suppress only when the turn read NOTHING from cache and the context is
// big enough that a full-price fork hurts.
const CACHE_COLD_TOKENS = 10_000

export const SUGGESTION_SETTING_KEY = 'promptSuggestionEnabled'

// Everything the fork needs, snapshotted where the loop settles (the CC cacheSafeParams equivalent).
// The key rides the snapshot (its lifetime is note → generate, seconds — the run itself held it longer);
// endpointId is optional because a collab expert input carries only the resolved key.
export interface SuggestionSnapshot {
  convId: string
  roleId: string
  protocol: 'anthropic' | 'openai' | 'gemini'
  baseUrl: string
  apiKey: string
  endpointId?: string
  model: string
  system: string
  tools: AnyToolSchema[]
  messages: AgentMessage[] // the loop's final in-memory transcript, assistant reply included
  maxTokens?: number
  thinking?: ThinkingParam
  cacheEnabled?: boolean
  threadId?: string
  lastContextTokens: number // the settled turn's full prompt size (cache included)
  lastCacheReadTokens: number // cache-read share of that prompt — >0 proves the cache pipeline works
}

function broadcast(convId: string, text: string): void {
  const ev: ConvSuggestion = { convId, text }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('conv:suggestion', ev)
}

class SuggestionService {
  private inflight = new Map<string, AbortController>()
  private snapshots = new Map<string, SuggestionSnapshot>()

  // A fresh run supersedes both the fork in flight AND the previous turn's snapshot — a stale snapshot
  // must never feed a later generate (e.g. a coordinator 'direct' turn that ran no expert loop).
  abortFor(convId: string): void {
    this.inflight.get(convId)?.abort()
    this.inflight.delete(convId)
    this.snapshots.delete(convId)
  }

  // Conversation deleted — stop work; the ghost dies with the composer that showed it.
  disposeForConv(convId: string): void {
    this.abortFor(convId)
  }

  // Called wherever an agent loop settles. Last write wins — in a multi-expert turn the suggestion forks
  // the expert who settled last (the one whose reply the user is reading).
  noteSnapshot(s: SuggestionSnapshot): void {
    this.snapshots.set(s.convId, s)
  }

  // Pre-generation gate, CC's suppress list mapped to Studio signals. Returns the reason (logged) or null.
  private suppressReason(s: SuggestionSnapshot): string | null {
    if (settingsService.get<boolean>(SUGGESTION_SETTING_KEY) === false) return 'disabled'
    // CC gates on terminal focus; for a GUI the right analogue is VISIBILITY, not OS focus — in a split-
    // screen the window is on screen (the ghost should appear) while focus sits in the other app. Only a
    // hidden/minimized app skips generation.
    if (!BrowserWindow.getAllWindows().some((w) => w.isVisible() && !w.isMinimized())) return 'unfocused'
    const expertTurns = convRepo.listByConversation(s.convId).filter((m) => m.author === 'expert').length
    if (expertTurns < 2) return 'early_conversation'
    if (s.lastCacheReadTokens === 0 && s.lastContextTokens > CACHE_COLD_TOKENS) return 'cache_cold'
    if (listPending(s.convId).length > 0) return 'pending_permission'
    return null
  }

  // Fire-and-forget from the conversation-turn settle point (solo persist / coordinator side-effects /
  // collab session end). Consumes the snapshot — one generation per noted turn, never a stale reuse.
  generateFromLatest(convId: string): void {
    const s = this.snapshots.get(convId)
    if (!s) return
    this.snapshots.delete(convId)
    const reason = this.suppressReason(s)
    if (reason) {
      console.log(`[suggestion] suppressed conv=${convId}: ${reason}`)
      return
    }
    this.inflight.get(convId)?.abort()
    const ac = new AbortController()
    this.inflight.set(convId, ac)
    void this.generate(s, ac.signal)
      .catch((err) => {
        if (ac.signal.aborted) return
        console.warn(`[suggestion] generate failed conv=${convId}:`, err instanceof Error ? err.message : err)
      })
      .finally(() => {
        if (this.inflight.get(convId) === ac) this.inflight.delete(convId)
      })
  }

  private async generate(s: SuggestionSnapshot, signal: AbortSignal): Promise<void> {
    const req: AgentLlmRequest = {
      protocol: s.protocol,
      baseUrl: s.baseUrl,
      apiKey: s.apiKey,
      model: s.model,
      system: s.system,
      messages: [...s.messages, { role: 'user', content: [{ type: 'text', text: SUGGESTION_INSTRUCTION }] }],
      tools: s.tools,
      maxTokens: s.maxTokens ?? 16384,
      cacheEnabled: s.cacheEnabled,
      conversationId: s.convId, // keeps OpenAI's prompt_cache_key identical to the run's
      threadId: s.threadId,
      endpointId: s.endpointId,
      roleId: s.roleId,
      thinking: s.thinking,
      signal,
      cacheSkipTrailingUser: true, // anchor the Anthropic breakpoint on the run's last user turn, not the instruction
    }
    // ONE hard turn, no tool execution: drain the generator, discard yielded tool_use blocks. A reply that
    // is all tool calls and no text simply yields no suggestion (the filter reports 'empty').
    const gen = callWithTools(req)
    for (;;) {
      const step = await gen.next()
      if (step.done) {
        if (signal.aborted) return
        const text = step.value.content
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('')
        const verdict = filterSuggestion(text)
        if (!verdict.ok) {
          // The rejected text rides the log (truncated) — it is the calibration data for the filter's
          // word/length thresholds (P2), and "rejected: too_many_words" alone says nothing actionable.
          console.log(`[suggestion] rejected conv=${s.convId}: ${verdict.reason} — "${text.trim().slice(0, 80)}"`)
          return
        }
        console.log(`[suggestion] generated conv=${s.convId}: "${verdict.text}"`)
        broadcast(s.convId, verdict.text)
        return
      }
    }
  }
}

export const suggestionService = new SuggestionService()
