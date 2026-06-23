// await_async tool (C3 §6.4) — wait for one or more agent-launched async ops (AsyncRegistry handles) and return
// their results. COLLAB-ONLY this round: ctx.async is wired by agent-collab; a solo run has none, so the tool
// errors with a clear pointer to the op's own wait (e.g. agent_wait) — solo long ops stay synchronous (§6.6 B2).
//
// 批6 wires the SYNCHRONOUS form (await the registry inside the call). 批8 upgrades collab to a TRUE suspend
// (the expert parks and is woken by the completion event) — the tool surface and result shape stay the same.

import { z } from 'zod'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'
import { formatAsyncHandle } from '../async-registry'

const inputSchema = z.strictObject({
  handles: z.array(z.string()).min(1).describe('The async handle id(s) to wait for (returned when you launched the op). Waits for ALL of them.'),
})

export const awaitAsyncTool = buildTool({
  name: 'await_async',
  inputSchema,
  prompt: () =>
    'Wait for one or more async operations you launched (by their handle ids) and return their results. Use it ' +
    'after launching a long/blocking op so you can report it started, keep coordinating, and pick up the result ' +
    "when it lands. Available in a collaboration; in a solo run, wait on the op's own tool (e.g. agent_wait) instead.",
  isReadOnly: () => true, // it only waits — the launched op carries its own permissions
  isConcurrencySafe: () => true,
  async call(input, ctx) {
    if (!ctx.async || !ctx.collab?.awaitHandles) {
      throw new Error('await_async is only available in a collaboration. In a solo run, wait on the operation’s own tool (e.g. agent_wait).')
    }
    // Split into already-settled vs still-running. All settled → return synchronously (no suspend). Any still
    // running → TRUE SUSPEND: park until they complete; the completion event wakes the expert and injects the
    // results (collab.ts notifyHandleComplete + runExpert T1), with the already-settled results riding along.
    // The collab suspend waits for ALL in-flight handles; a session abort (or asyncRegistry.dispose on session
    // end) is the backstop. mode/timeoutMs were REMOVED from the schema so the tool contract matches the wired
    // behavior (the earlier schema advertised early-return / timeout that the collab suspend never honored).
    const inflight: string[] = []
    const settled: string[] = []
    let known = 0
    for (const id of input.handles) {
      const h = ctx.async.get(id)
      if (!h) continue
      known++
      if (h.status === 'running') inflight.push(id)
      else settled.push(formatAsyncHandle(h))
    }
    if (known === 0) {
      return { data: `No matching async handles for: ${input.handles.join(', ')}. Check the ids (a launched op returns its handle id).` }
    }
    if (inflight.length === 0) {
      return { data: settled.join('\n') } // every handle already done → no need to park
    }
    return { data: ctx.collab.awaitHandles(inflight, settled) }
  },
  mapResult: stringResult,
})

function stringResult(out: string, toolUseId: string): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: toolUseId, content: out }
}
