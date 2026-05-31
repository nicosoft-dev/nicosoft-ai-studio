// Anthropic tool-use LLM call for the agent loop. Unlike llm/anthropic.ts (plain text chat), this
// sends a `tools` param and assembles streamed tool_use blocks into a full assistant turn. Reuses
// the shared SSE plumbing (openStream/iterSSE). See docs/nicosoft-studio/12-hex-coding-agent.md §2.4.

import { iterSSE, openStream, parseJSON, toLlmError } from '../llm/_shared'
import type {
  AgentMessage,
  AssistantTurn,
  StopReason,
  TextBlock,
  ToolSchema,
  ToolUseBlock,
} from './types'

const PROVIDER = 'anthropic'
const ANTHROPIC_VERSION = '2023-06-01'

export interface AgentLlmRequest {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  messages: AgentMessage[]
  tools: ToolSchema[]
  maxTokens: number
  signal?: AbortSignal
}

// Streaming events surfaced to the caller (UI): text deltas + tool-call lifecycle.
export type AgentLlmEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_input'; id: string; delta: string }

// The subset of Anthropic SSE event fields we read. Everything else is ignored.
interface StreamEvent {
  type: string
  index?: number
  message?: { usage?: { input_tokens?: number } }
  content_block?: { type?: string; text?: string; id?: string; name?: string }
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
  usage?: { output_tokens?: number }
}

// Per-index accumulator. tool_use input streams as partial_json string fragments that only become
// valid JSON once concatenated — never parse a fragment alone.
type Accum =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; json: string }

// POST /v1/messages (Anthropic protocol) with tools, stream the reply, assemble the assistant turn.
export async function callWithTools(
  req: AgentLlmRequest,
  onEvent?: (e: AgentLlmEvent) => void,
): Promise<AssistantTurn> {
  const url = `${req.baseUrl.replace(/\/$/, '')}/v1/messages`
  const body = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
    tools: req.tools,
    stream: true,
  }
  const reader = await openStream(PROVIDER, url, {
    method: 'POST',
    headers: {
      'x-api-key': req.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: req.signal,
  })

  const blocks: Accum[] = []
  let stopReason: StopReason = null
  let inTokens = 0
  let outTokens = 0

  try {
    for await (const payload of iterSSE(reader)) {
      const ev = parseJSON(payload) as StreamEvent | null
      if (!ev || typeof ev.type !== 'string') continue
      const idx = ev.index ?? 0
      switch (ev.type) {
        case 'message_start':
          inTokens = ev.message?.usage?.input_tokens ?? 0
          break
        case 'content_block_start': {
          const cb = ev.content_block
          if (cb?.type === 'text') {
            blocks[idx] = { type: 'text', text: cb.text ?? '' }
          } else if (cb?.type === 'tool_use') {
            // Synthesize id/name if malformed so the block still round-trips and gets a paired
            // tool_result — silently dropping it can empty the turn (→ 400 / false-complete).
            const id = cb.id || `synthetic_${idx}`
            const name = cb.name || 'unknown'
            blocks[idx] = { type: 'tool_use', id, name, json: '' }
            onEvent?.({ type: 'tool_use_start', id, name })
          }
          break
        }
        case 'content_block_delta': {
          const d = ev.delta
          const blk = blocks[idx]
          if (d?.type === 'text_delta' && blk?.type === 'text' && typeof d.text === 'string') {
            blk.text += d.text
            onEvent?.({ type: 'text', delta: d.text })
          } else if (
            d?.type === 'input_json_delta' &&
            blk?.type === 'tool_use' &&
            typeof d.partial_json === 'string'
          ) {
            blk.json += d.partial_json
            onEvent?.({ type: 'tool_use_input', id: blk.id, delta: d.partial_json })
          }
          break
        }
        case 'message_delta':
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason as StopReason
          if (typeof ev.usage?.output_tokens === 'number') outTokens = ev.usage.output_tokens
          break
        default:
          break
      }
    }
  } catch (err) {
    throw toLlmError(PROVIDER, err)
  }

  // Finalize: parse each tool_use's accumulated JSON into an object.
  const content: Array<TextBlock | ToolUseBlock> = []
  for (const b of blocks) {
    if (!b) continue
    if (b.type === 'text') {
      content.push({ type: 'text', text: b.text })
    } else {
      const input = (parseJSON(b.json || '{}') as Record<string, unknown> | null) ?? {}
      content.push({ type: 'tool_use', id: b.id, name: b.name, input })
    }
  }

  return { content, stopReason, usage: { inTokens, outTokens } }
}
