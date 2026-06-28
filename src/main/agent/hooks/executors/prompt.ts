// hooks/executors/prompt.ts — the prompt hook: a ONE-SHOT LLM judgement. The model is asked to evaluate the
// hook's condition against the event payload and reply with STRICT JSON {"ok":boolean,"reason":string}. ok=true
// passes; ok=false blocks with the reason (on a stop-class event the engine turns that into a continuation
// nudge, on a tool event into a deny). No tools, no transcript — a fast yes/no gate. The agent hook (agent.ts)
// is the tool-bearing, repo-inspecting cousin.

import { readFile } from 'node:fs/promises'
import { chatAnthropic } from '../../../llm/anthropic'
import { chatOpenAI } from '../../../llm/openai'
import { chatGemini } from '../../../llm/gemini'
import type { ChatFn } from '../../../llm/types'
import type { PromptHookConfig, HookExecContext, HookOutcome, HookLlmAccess } from '../types'
import type { HookPayload } from '../events'
import { eventMeta } from '../events'
import { parseJudgement, judgementToOutcome } from '../judgement'

const TRANSCRIPT_TAIL_CHARS = 12_000 // feed the tail of the run transcript so a stop condition is judged from evidence

// The system prompt is event-aware (mirrors the reference's two prompt variants): a STOP-class event judges "may
// the agent stop?" strictly from transcript evidence and may declare the condition unsatisfiable (impossible) so
// the runtime stops retrying; any other event is a plain yes/no condition gate.
function systemFor(isStopClass: boolean): string {
  if (isStopClass) {
    return (
      'You are a hook condition evaluator inside an autonomous agent runtime, deciding whether the agent may STOP. ' +
      'You are given a CONDITION, a JSON EVENT payload, and (when available) the TRANSCRIPT tail of the run so far. ' +
      'Judge the condition ONLY against transcript evidence — do not assume work happened that the transcript does ' +
      'not show. Reply with ONLY a single JSON object on one line: {"ok": boolean, "reason": string, "impossible": boolean}. ' +
      'ok=true = satisfied (the agent may stop); ok=false = not yet (keep going), reason says what is missing; ' +
      'impossible=true ONLY if the condition can NEVER be satisfied no matter what the agent does (e.g. it requires a ' +
      'capability that does not exist) — set it so the runtime stops retrying. Output nothing but that JSON.'
    )
  }
  return (
    'You are a hook condition evaluator inside an autonomous agent runtime. You are given a CONDITION and a JSON ' +
    'EVENT payload. Decide whether the condition is satisfied. Reply with ONLY a single JSON object on one line: ' +
    '{"ok": boolean, "reason": string}. ok=true means the condition holds (allow); ok=false means it does not ' +
    '(block), and reason explains briefly what is wrong. Output nothing but that JSON.'
  )
}

// Read the tail of the run transcript (best-effort) so a stop-class prompt hook can judge from evidence.
async function readTranscriptTail(path: unknown): Promise<string> {
  if (typeof path !== 'string' || !path) return ''
  try {
    const buf = await readFile(path, 'utf8')
    return buf.length > TRANSCRIPT_TAIL_CHARS ? buf.slice(-TRANSCRIPT_TAIL_CHARS) : buf
  } catch {
    return '' // transcript not readable → judge from the event payload alone
  }
}

function chatFor(protocol: HookLlmAccess['protocol']): ChatFn {
  return protocol === 'openai' ? chatOpenAI : protocol === 'gemini' ? chatGemini : chatAnthropic
}

export async function executePromptHook(config: PromptHookConfig, payload: HookPayload, opts: HookExecContext): Promise<HookOutcome> {
  if (!opts.llm) return { outcome: 'success' } // no LLM access in this context → silently pass (fail-open skip)
  const meta = eventMeta(payload.hook_event_name)
  const model = config.model ?? opts.llm.model
  const chat = chatFor(opts.llm.protocol)
  // Stop-class: feed the transcript tail so the condition is judged from evidence (the reference's "judge based on
  // the transcript" path); other events judge from the condition + payload alone.
  const transcript = meta.isStopClass ? await readTranscriptTail(payload.transcript_path) : ''
  let text: string
  try {
    const res = await chat(
      {
        protocol: opts.llm.protocol,
        baseUrl: opts.llm.baseUrl,
        apiKey: opts.llm.apiKey,
        model,
        messages: [
          { role: 'system', content: systemFor(meta.isStopClass) },
          {
            role: 'user',
            content: `CONDITION:\n${config.prompt}\n\nEVENT:\n${JSON.stringify(payload, null, 2)}` + (transcript ? `\n\nTRANSCRIPT (tail):\n${transcript}` : ''),
          },
        ],
        signal: opts.signal,
      },
      () => {},
    )
    text = res.text
  } catch (err) {
    if (opts.signal.aborted) return { outcome: 'cancelled' }
    return { outcome: 'non_blocking_error', systemMessage: `Prompt hook LLM call failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  // impossible (stop-class) → let the agent stop; ok=false → deny (tool) / continuation (stop) / advisory (continueOnBlock).
  return judgementToOutcome(parseJudgement(text, 'Prompt hook'), payload, { continueOnBlock: config.continueOnBlock, label: 'Prompt hook' })
}
