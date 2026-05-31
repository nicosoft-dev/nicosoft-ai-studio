// Hex agent service — now a CHAT reply engine. A Hex turn is one agent run, but it's wrapped in the
// chat layer: persist the user turn, recall memories + history from the conversation, inject them into
// the agent's system, run the ReAct loop, persist the final reply, then fire memory extraction +
// compression. The agent loop (agent/loop.ts) itself is unchanged — it just gets a richer system + a
// multi-turn seed. Tool steps stay in the per-session transcript (~/.nsai/sessions/<convId>/), not in
// the messages table; messages hold only the final reply (clean for memory extraction + history).

import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ulid } from '../db/id'
import type { AgentContext, RequestPermission } from '../agent/context'
import type { AgentLlmEvent } from '../agent/llm'
import { runAgent, type AgentEvent, type AgentResult } from '../agent/loop'
import { isContentBlock } from '../agent/types'
import type { AgentMessage, AnyBlock } from '../agent/types'
import { CORE_TOOLS } from '../agent/registry'
import { HEX_SYSTEM_PROMPT } from '../agent/system-prompt'
import type { AgentRunInput } from '../ipc/contracts'
import * as keychain from '../keychain/keychain'
import { LlmError } from '../llm/types'
import * as endpointRepo from '../repos/endpoint.repo'
import * as convRepo from '../repos/conversation.repo'
import * as summaryRepo from '../repos/summary.repo'
import * as usageRepo from '../repos/usage.repo'
import type { MemoryRow } from '../repos/memory.repo'
import * as convService from './conversation.service'
import * as memoryService from './memory.service'
import * as compressionService from './compression.service'

const HEX_ROLE_ID = 'hex' // this version's agent is Hex-only

export interface AgentCallbacks {
  onStream: (e: AgentLlmEvent) => void // fine-grained deltas (text + tool_use input) for streaming UI
  onEvent: (e: AgentEvent) => void // completed assistant turns + tool_results
  requestPermission: RequestPermission // bridged to the renderer (req, optional cancel signal)
}

export async function run(
  input: AgentRunInput,
  cb: AgentCallbacks,
  signal: AbortSignal,
): Promise<{ reason: string; turns: number; convId: string; runId: string }> {
  const ep = endpointRepo.getById(input.endpointId)
  if (!ep) throw new LlmError('bad_request', 'endpoint not found')
  // Hex's loop speaks the Anthropic Messages protocol (tool use over /v1/messages).
  if (ep.protocol !== 'anthropic') {
    throw new LlmError('bad_request', 'Hex requires an Anthropic-protocol endpoint')
  }
  const key = keychain.getApiKey(input.endpointId)
  if (!key) throw new LlmError('bad_key', 'no API key configured for this endpoint')

  const convId = input.convId
  const runId = ulid()

  // ① Persist the user turn (tagged with run_id) so context assembly + extraction read it from the DB.
  const userImages = (input.images ?? []).map((i) => ({ url: i.dataUrl }))
  convService.append(convId, {
    author: 'user',
    expertId: HEX_ROLE_ID,
    content: input.prompt,
    attachments: userImages,
    runId,
  })

  // ② chat-layer context: recall memories + the history after the latest summary's boundary + summary.
  const memories = await memoryService.recall({
    convId,
    roleId: HEX_ROLE_ID,
    endpointId: input.endpointId,
    model: input.model,
  })
  const history = convRepo.listByConversation(convId)
  const summary = summaryRepo.getLatest(convId)
  const recent = summary?.coveredUpTo != null ? history.filter((m) => m.id > summary.coveredUpTo!) : history

  // ③ Agent system = HEX prompt + injected memories + summary; seed = history → AgentMessage (Anthropic
  //    needs a user-first list, so drop any leading assistant turns left by a fold boundary).
  const system = buildHexSystem(memories, summary?.content ?? null)
  const mapped = conversationToAgentMessages(recent)
  const firstUser = mapped.findIndex((m) => m.role === 'user')
  const seed = firstUser > 0 ? mapped.slice(firstUser) : mapped

  const sessionDir = join(homedir(), '.nsai', 'sessions', convId)
  await mkdir(join(sessionDir, 'tool-results'), { recursive: true })
  const transcript = createWriteStream(join(sessionDir, 'transcript.jsonl'), { flags: 'a' })
  // Without an 'error' listener a failed write (disk full / perms) crashes the main process — swallow.
  transcript.on('error', () => {})
  const log = (obj: unknown): void => void transcript.write(JSON.stringify(obj) + '\n')
  log({ t: 'run', runId, convId, cwd: input.cwd, model: input.model })

  const ctx: AgentContext = {
    cwd: input.cwd,
    signal,
    readFileState: new Map(),
    permissionMode: 'default', // read-only auto-allows; writes / dangerous ops ask via the UI
    requestPermission: cb.requestPermission,
    todos: [],
    sessionDir,
  }

  const gen = runAgent({
    baseUrl: ep.baseUrl,
    apiKey: key,
    model: input.model,
    system,
    messages: seed,
    tools: CORE_TOOLS,
    ctx,
    contextWindow: input.contextWindow ?? 200_000,
    thinking: input.thinking,
    onStream: cb.onStream,
  })

  let result!: AgentResult
  let inTokens = 0
  let outTokens = 0
  try {
    for (;;) {
      const { value, done } = await gen.next()
      if (done) {
        log({ t: 'done', runId, reason: value.reason, turns: value.turns })
        result = value
        break
      }
      if (value.type === 'assistant') {
        inTokens += value.usage.inTokens
        outTokens += value.usage.outTokens
      }
      log({ t: 'event', runId, event: value })
      cb.onEvent(value)
    }
  } finally {
    transcript.end()
  }

  // ⑤ Persist the assistant's FINAL reply (same run_id). Tool steps stay in the transcript only.
  //    Skip an empty reply (abort / a turn that produced no text) — an empty assistant text block would
  //    make the NEXT run's reconstructed seed 400 on Anthropic.
  const finalText = finalAssistantText(result.messages)
  if (finalText) {
    convService.append(convId, {
      author: 'expert',
      expertId: HEX_ROLE_ID,
      model: input.model,
      content: finalText,
      runId,
    })
  }

  // Record usage — a Hex run spans many turns; without this it's invisible to usage stats.
  usageRepo.record({ model: input.model, provider: ep.protocol, inTokens, outTokens })

  // ⑥ chat-layer side effects, fire-and-forget so they don't delay the run's completion (mirrors the
  //    plain-chat onDone path: memory extraction cadence + compression check). contextWindow is passed
  //    explicitly because Hex's model may not be in the endpoint's availableModels catalog.
  void memoryService
    .onTurn({ convId, roleId: HEX_ROLE_ID, endpointId: input.endpointId, model: input.model })
    .catch(() => {})
  void compressionService
    .maybeCompress({
      convId,
      roleId: HEX_ROLE_ID,
      endpointId: input.endpointId,
      model: input.model,
      contextWindow: input.contextWindow,
    })
    .catch(() => {})

  return { reason: result.reason, turns: result.turns, convId, runId }
}

// HEX system prompt + the chat layer's injected context (recalled memories, conversation summary).
function buildHexSystem(memories: MemoryRow[], summary: string | null): string {
  const parts = [HEX_SYSTEM_PROMPT]
  if (memories.length) {
    parts.push(
      "What you've learned about this user (engineering preferences, project conventions):\n" +
        memories.map((m) => `- ${m.content}`).join('\n'),
    )
  }
  if (summary) parts.push('Summary of earlier in this conversation:\n' + summary)
  return parts.join('\n\n')
}

// Persisted conversation messages → agent seed. Assistant turns are prior runs' FINAL replies (plain
// text — tool steps were never persisted); user turns carry text + any image attachments.
function conversationToAgentMessages(messages: convRepo.MessageRow[]): AgentMessage[] {
  const out: AgentMessage[] = []
  for (const m of messages) {
    if (m.author === 'user') {
      const content: AnyBlock[] = []
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const a of m.attachments as { url?: string }[]) {
        if (typeof a.url !== 'string') continue
        const mm = /^data:([^;]+);base64,(.*)$/s.exec(a.url)
        if (mm) content.push({ type: 'image', source: { type: 'base64', media_type: mm[1], data: mm[2] } })
      }
      if (content.length === 0) content.push({ type: 'text', text: '' })
      out.push({ role: 'user', content })
    } else if (m.content) {
      // Skip an empty assistant turn — Anthropic rejects an empty text block in the seed.
      out.push({ role: 'assistant', content: [{ type: 'text', text: m.content }] })
    }
  }
  return out
}

// The final assistant reply text from a completed run's messages — the last assistant turn's text.
function finalAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const text = m.content
      .filter((b): b is { type: 'text'; text: string } => isContentBlock(b) && b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (text.trim()) return text
  }
  return ''
}
