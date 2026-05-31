// Hex agent service: resolve endpoint + key, run the agent loop against the project cwd, and persist
// a per-session transcript under ~/.nsai/sessions/<convId>/. Streaming + permission bridging happen
// in the IPC boundary (agent.handler.ts); this service is the loop driver. Mirrors chat.service's
// resolve pattern but drives runAgent (tool use) instead of a plain chat.

import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ulid } from 'ulid'
import type { AgentContext, RequestPermission } from '../agent/context'
import type { AgentLlmEvent } from '../agent/llm'
import { runAgent, type AgentEvent } from '../agent/loop'
import type { AnyBlock } from '../agent/types'
import { CORE_TOOLS } from '../agent/registry'
import { HEX_SYSTEM_PROMPT } from '../agent/system-prompt'
import type { AgentRunInput } from '../ipc/contracts'
import * as keychain from '../keychain/keychain'
import { LlmError } from '../llm/types'
import * as endpointRepo from '../repos/endpoint.repo'

export interface AgentCallbacks {
  onStream: (e: AgentLlmEvent) => void // fine-grained deltas (text + tool_use input) for streaming UI
  onEvent: (e: AgentEvent) => void // completed assistant turns + tool_results
  requestPermission: RequestPermission // bridged to the renderer (req, optional cancel signal)
}

export async function run(
  input: AgentRunInput,
  cb: AgentCallbacks,
  signal: AbortSignal,
): Promise<{ reason: string; turns: number; convId: string }> {
  const ep = endpointRepo.getById(input.endpointId)
  if (!ep) throw new LlmError('bad_request', 'endpoint not found')
  // Hex's loop speaks the Anthropic Messages protocol (tool use over /v1/messages).
  if (ep.protocol !== 'anthropic') {
    throw new LlmError('bad_request', 'Hex requires an Anthropic-protocol endpoint')
  }
  const key = keychain.getApiKey(input.endpointId)
  if (!key) throw new LlmError('bad_key', 'no API key configured for this endpoint')

  const convId = input.convId ?? ulid()
  const sessionDir = join(homedir(), '.nsai', 'sessions', convId)
  await mkdir(join(sessionDir, 'tool-results'), { recursive: true })
  const transcript = createWriteStream(join(sessionDir, 'transcript.jsonl'), { flags: 'a' })
  // Without an 'error' listener a failed write (disk full / perms) emits an unhandled 'error' that
  // crashes the whole main process — for a logging side channel, swallow it.
  transcript.on('error', () => {})
  const log = (obj: unknown): void => void transcript.write(JSON.stringify(obj) + '\n')
  log({ t: 'run', convId, cwd: input.cwd, model: input.model })

  const ctx: AgentContext = {
    cwd: input.cwd,
    signal,
    readFileState: new Map(),
    permissionMode: 'default', // read-only auto-allows; writes / dangerous ops ask via the UI
    requestPermission: cb.requestPermission,
    todos: [],
    sessionDir,
  }

  // Build the seed user turn: prompt text first, then any pasted images as base64 image blocks (ccb
  // order — text before images). data: URLs are split into the Anthropic base64 source.
  const userContent: AnyBlock[] = []
  if (input.prompt) userContent.push({ type: 'text', text: input.prompt })
  for (const img of input.images ?? []) {
    const m = /^data:[^;]+;base64,(.*)$/s.exec(img.dataUrl)
    userContent.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: m ? m[1] : img.dataUrl } })
  }
  if (userContent.length === 0) userContent.push({ type: 'text', text: '' })

  const gen = runAgent({
    baseUrl: ep.baseUrl,
    apiKey: key,
    model: input.model,
    system: HEX_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
    tools: CORE_TOOLS,
    ctx,
    contextWindow: input.contextWindow ?? 200_000,
    thinking: input.thinking,
    onStream: cb.onStream,
  })

  try {
    for (;;) {
      const { value, done } = await gen.next()
      if (done) {
        log({ t: 'done', reason: value.reason, turns: value.turns })
        return { reason: value.reason, turns: value.turns, convId }
      }
      log({ t: 'event', event: value })
      cb.onEvent(value)
    }
  } finally {
    transcript.end()
  }
}
