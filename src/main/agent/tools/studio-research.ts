// studio_research — the agent-driven deep-research tool (research-role-driven-redesign §4.1), the sibling of
// studio_lens. Lets ANY agent role run a multi-source web-research fan-out (search → read sources → adversarially
// verify → synthesize) in its OWN turn and get back a cited report. The fan-out lives behind ctx.research
// (services/research/research-handle) — this file is the tool surface + the guidance the model reads. Like lens,
// when an async registry is present the tool launches a BACKGROUND handle and the role await_asyncs the report,
// so the progress card lives in the Tasks panel and the role reports the result in chat.

import { z } from 'zod'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'
import type { StudioResearchResult } from '../context'

const inputSchema = z.object({
  question: z.string().min(1).describe('The research question — a specific, well-scoped question to investigate across the open web.')
})

export const studioResearchTool = buildTool<typeof inputSchema, StudioResearchResult>({
  name: 'studio_research',
  inputSchema,
  prompt: () =>
    'Run a DEEP, multi-source web-research pass on a question and get back a CITED report — far more than a single ' +
    'web search. It fans out independent web-researcher sub-agents (find sources → read them → adversarially verify ' +
    'the claims → synthesize), all under YOUR endpoint. Reach for it when the user wants researched, fact-checked ' +
    'findings on a topic, or when substantial work needs grounding in current external sources.\n' +
    'A user message of the form `/research <question>` is a DIRECT command to run this — call studio_research with ' +
    'that exact question immediately: do NOT answer from memory, do NOT ask to confirm, do NOT do other work first.\n' +
    'INPUT: the question. OUTPUT: a cited markdown report, which you then relay to the user in your own message. ' +
    'It is READ-ONLY (the open web only — it never reads local files or edits code).',
  isReadOnly: () => true,
  async call(input, ctx) {
    // ctx.research is set only on a top-level agent run (handle-presence ⟺ tool-presence). Absent inside a
    // sub-agent → say so plainly rather than returning a silent empty result the model reads as "done".
    if (!ctx.research) {
      return { data: { ok: false, message: 'studio_research is not available here — it cannot be run from inside a sub-agent.' } }
    }
    const question = (input.question ?? '').trim()
    if (!question) return { data: { ok: false, message: 'studio_research needs a question — pass `question`.' } }
    // ASYNC drive (mirrors studio_lens): when an async registry is present — a collaboration OR a solo direct-chat —
    // launch the deep-research fan-out as a BACKGROUND handle (its progress card lives in the Tasks panel) and
    // await_async it to pick up the cited report. A long research run is exactly the case to park, not block.
    if (ctx.async) {
      const label = `research: ${question.slice(0, 80)}${question.length > 80 ? '…' : ''}`
      const handle = ctx.async.launch('research', label, (signal, id) => ctx.research!.run({ question, signal, asyncHandleId: id }))
      return {
        data: {
          ok: true,
          message:
            `Deep research launched on: "${question}". In your user-facing message, say the research started + what ` +
            `it covers, and do NOT print, quote, or mention the handle id ANYWHERE in that message. Then (separately) ` +
            `call await_async with ["${handle.id}"] exactly ONCE to pick up the cited report — that suspends you ` +
            `until it lands; do NOT call await_async repeatedly.`
        }
      }
    }
    return { data: await ctx.research.run({ question }) }
  },
  mapResult(out, toolUseId): ToolResultBlock {
    return { type: 'tool_result', tool_use_id: toolUseId, content: out.message || '(studio_research returned no result)', is_error: !out.ok }
  }
})
