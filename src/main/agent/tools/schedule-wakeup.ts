// schedule_wakeup — the agent's self-pacing tool. It lets the model choose when to wake itself next: give a
// delay (seconds) and a prompt, and at that time the prompt is delivered back into THIS conversation (the agent
// resumes with it). Unlike schedule_create (a user-facing cron task), this is the model setting its own rhythm —
// e.g. "re-check the deploy in 5 minutes". delaySeconds is clamped to [60, 3600] at the runtime.

import { z } from 'zod'
import { buildTool } from '../tool'
import type { AgentContext } from '../context'
import type { ToolResultBlock } from '../types'
import { selfRhythmService } from '../../services/self-rhythm.service'

const schema = z.object({
  delaySeconds: z.number().optional().describe('How long from now to wake yourself, in seconds (clamped to [60, 3600]). Tip: a prompt cache lasts ~5 minutes — pick ≤270s to stay within it, or ≥1200s to amortize a cold prompt; avoid ~300s. Required unless `cancel` is set.'),
  prompt: z.string().optional().describe('The instruction delivered to you when the timer fires (e.g. "re-check the CI run and report if it finished"). Required unless `cancel` is set.'),
  recurring: z
    .boolean()
    .optional()
    .describe('If true, automatically re-arm after each wake with the same prompt + delay — a sustained, self-paced loop (e.g. "every 5 min, re-check the stream and react"). It runs until you stop it with `cancel`. Omit for a one-shot wake. For a loop where YOU pick the next delay each time, leave recurring off and simply call schedule_wakeup again when you wake.'),
  cancel: z.string().optional().describe('Cancel a previously-scheduled wakeup by its id — use this to STOP a recurring self-wakeup loop. When set, delaySeconds/prompt/recurring are ignored.'),
})

function textResult(toolUseId: string, text: string, isError = false): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: toolUseId, content: text, is_error: isError }
}

export const scheduleWakeupTool = buildTool({
  name: 'schedule_wakeup',
  inputSchema: schema,
  prompt: () =>
    'Schedule your OWN next wakeup: after `delaySeconds` (clamped to [60, 3600]), `prompt` is delivered back ' +
    'into this conversation and you resume to act on it — no user message needed. Use it to pace self-checks ' +
    '(poll a deploy, re-evaluate a condition) instead of blocking or busy-waiting. Set `recurring:true` for a ' +
    'sustained self-paced loop (re-arms every interval until you `cancel` it); pass `cancel:<id>` to stop one. ' +
    'For a condition a probe can watch, prefer monitor_start (wakes only on change); use schedule_wakeup for ' +
    'time-based pacing.',
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  call: async (input, ctx: AgentContext) => {
    if (!ctx.convId) return { data: { error: 'schedule_wakeup is unavailable in this context (no conversation).' } }
    if (input.cancel) {
      const cancelled = selfRhythmService.cancel(input.cancel)
      return { data: { cancelled, id: input.cancel } }
    }
    if (input.delaySeconds === undefined || !input.prompt) {
      return { data: { error: 'schedule_wakeup needs both delaySeconds and prompt (or `cancel` with a wakeup id to stop one).' } }
    }
    const { id, delaySeconds } = selfRhythmService.schedule(ctx.convId, input.prompt, input.delaySeconds, { roleId: ctx.roleId, recurring: input.recurring })
    return { data: { id, delaySeconds, recurring: input.recurring === true } }
  },
  mapResult: (out: { id?: string; delaySeconds?: number; recurring?: boolean; cancelled?: boolean; error?: string }, toolUseId) => {
    if (out.error) return textResult(toolUseId, out.error, true)
    if (out.cancelled !== undefined) {
      return textResult(toolUseId, out.cancelled ? `Self-wakeup ${out.id} cancelled.` : `No active self-wakeup with id ${out.id} (already fired or cancelled).`, !out.cancelled)
    }
    const loop = out.recurring ? ` It re-arms every ${out.delaySeconds}s until you cancel it (id: ${out.id}).` : ''
    return textResult(toolUseId, `Self-wakeup scheduled (id: ${out.id}). This conversation will resume in ${out.delaySeconds}s with your prompt — you do not need to wait.${loop} Stop here.`)
  },
})
