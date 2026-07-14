// studio_design — the agent-driven design-review tool (research-role-driven-redesign §4.1), the sibling of
// studio_research / studio_lens. Lets ANY agent role run a judge-panel design review (N independent solution
// attempts from different angles → parallel judges score them → a synthesis from the winner grafting the best of
// the rest) in its OWN turn, and get back a scored design synthesis. The fan-out lives behind ctx.design
// (services/design/design-handle). When an async registry is present the tool launches a BACKGROUND handle and
// the role await_asyncs the synthesis, so the progress card lives in the Tasks panel and the role reports the result.

import { z } from 'zod'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'
import type { StudioDesignResult } from '../context'

const inputSchema = z.object({
  problem: z.string().min(1).describe('The design problem — a specific, well-scoped question of HOW to build/structure something, to explore from multiple angles.')
})

export const studioDesignTool = buildTool<typeof inputSchema, StudioDesignResult>({
  name: 'studio_design',
  inputSchema,
  prompt: () =>
    'Run a JUDGE-PANEL design review on a design problem and get back a scored synthesis — far more than reasoning ' +
    'it through once. It generates several INDEPENDENT solution attempts from different angles (e.g. MVP-first, ' +
    'risk-first, user-first), scores them with parallel judges, then synthesizes from the winner while grafting the ' +
    'best ideas from the runners-up — all under YOUR endpoint. Reach for it on a genuinely open design question ' +
    'where the solution space is wide (architecture, an API/schema shape, a migration strategy, a hard trade-off).\n' +
    'A user message of the form `/design <problem>` is a DIRECT command to run this — call studio_design with that ' +
    'exact problem immediately: do NOT answer from memory, do NOT ask to confirm, do NOT do other work first.\n' +
    'INPUT: the design problem. OUTPUT: a scored design synthesis, which you then relay to the user in your own ' +
    'message. It is READ-ONLY (it reasons over the problem — it never edits code).',
  isReadOnly: () => true,
  async call(input, ctx) {
    if (!ctx.design) {
      return { data: { ok: false, message: 'studio_design is not available here — it cannot be run from inside a sub-agent.' } }
    }
    const problem = (input.problem ?? '').trim()
    if (!problem) return { data: { ok: false, message: 'studio_design needs a problem statement — pass `problem`.' } }
    if (ctx.async) {
      const label = `design: ${problem.slice(0, 80)}${problem.length > 80 ? '…' : ''}`
      const handle = ctx.async.launch('design', label, (signal, id) => ctx.design!.run({ problem, signal, asyncHandleId: id }))
      return {
        data: {
          ok: true,
          message:
            `Design review launched on: "${problem}". In your user-facing message, say the design review started + ` +
            `what it covers, and do NOT print, quote, or mention the handle id ANYWHERE in that message. Then ` +
            `(separately) call await_async with ["${handle.id}"] exactly ONCE to pick up the scored synthesis — that ` +
            `suspends you until it lands; do NOT call await_async repeatedly.`
        }
      }
    }
    return { data: await ctx.design.run({ problem }) }
  },
  mapResult(out, toolUseId): ToolResultBlock {
    return { type: 'tool_result', tool_use_id: toolUseId, content: out.message || '(studio_design returned no result)', is_error: !out.ok }
  }
})
