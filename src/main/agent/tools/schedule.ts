// schedule_create / schedule_list / schedule_delete (batch 1 / doc 28) — the role's interface to the
// scheduled-task store (ported from ccb's CronCreate/List/Delete). Batch 1 is create/list/delete only; the
// engine that actually fires tasks is batch 2. cwd defaults to the creating agent's cwd, which becomes the
// task's pre-authorized working dir (full perms inside it when fired — doc 28 §5.1).

import { z } from 'zod'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'
import { scheduledTaskStore, type ScheduledTask } from '../scheduler/store'

function fmtTask(t: ScheduledTask): string {
  const when = new Date(t.nextRunAt).toLocaleString()
  const kind = t.recurring ? `recurring (${t.cron})` : 'one-shot'
  const role = t.roleId ? ` · role=${t.roleId}` : ''
  return `${t.id}  next=${when}  ${kind}${role}${t.durable ? ' · durable' : ''} — ${t.prompt.slice(0, 60)}`
}

function stringResult(out: string, toolUseId: string): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: toolUseId, content: out }
}

export const scheduleCreateTool = buildTool({
  name: 'schedule_create',
  inputSchema: z.strictObject({
    schedule: z
      .string()
      .describe(
        'When to run: an interval ("5m" / "2h" / "1d"), a one-shot datetime ("2026-06-05T15:00", local), or a 5-field cron ("0 9 * * 1-5", local time)'
      ),
    prompt: z.string().describe('What to do when it fires — the instruction run as an agent turn'),
    role: z.string().optional().describe('Executor role id (any role, e.g. "engineer"); defaults to the scheduler'),
    cwd: z
      .string()
      .optional()
      .describe('Working dir the task is pre-authorized to act in (full permission inside it when fired); defaults to your current cwd'),
    durable: z
      .boolean()
      .optional()
      .describe(
        'true = persist across app restarts. Default false = session-only (gone when the app closes). Only pass true when the user explicitly wants it kept ("every day", "permanently")'
      ),
  }),
  prompt: () =>
    'Create a scheduled task that fires later. "schedule" is an interval (5m/2h/1d), a one-shot datetime, ' +
    'or a 5-field cron (local time). When it fires, "prompt" runs as an agent turn by "role" (default ' +
    'scheduler) inside "cwd" (where it has full permission). Keep it session-only (durable:false) unless ' +
    'the user wants it to survive restarts. Use for "remind me / run X every / at <time> do Y".',
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  async call(input, ctx) {
    const task = scheduledTaskStore.create(
      {
        schedule: input.schedule,
        prompt: input.prompt,
        roleId: input.role,
        cwd: input.cwd ?? ctx.cwd,
        durable: input.durable,
      },
      Date.now()
    )
    return {
      data:
        `Scheduled ${task.id} — next run ${new Date(task.nextRunAt).toLocaleString()} ` +
        `(${task.recurring ? `recurring ${task.cron}` : 'one-shot'}${task.durable ? ', durable' : ', session-only'}).`,
    }
  },
  mapResult: stringResult,
})

export const scheduleListTool = buildTool({
  name: 'schedule_list',
  inputSchema: z.strictObject({}),
  prompt: () => 'List the scheduled tasks (id, next run time, recurring/one-shot, role, prompt).',
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call() {
    const tasks = scheduledTaskStore.list()
    if (!tasks.length) return { data: 'No scheduled tasks.' }
    return { data: `${tasks.length} scheduled task(s):\n` + tasks.map(fmtTask).join('\n') }
  },
  mapResult: stringResult,
})

export const scheduleDeleteTool = buildTool({
  name: 'schedule_delete',
  inputSchema: z.strictObject({ id: z.string().describe('Task id from schedule_list') }),
  prompt: () => 'Delete (cancel) a scheduled task by its id.',
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
  async call(input) {
    const ok = scheduledTaskStore.delete(input.id)
    return { data: ok ? `Deleted scheduled task ${input.id}.` : `No scheduled task with id "${input.id}".` }
  },
  mapResult: stringResult,
})
