// Scheduled-task storage (batch 1 / doc 28). Two modes:
//   • durable: true  → persisted to ~/.nsai/scheduled_tasks.json, survives restarts.
//   • durable: false → in-memory, lives only for this main-process run (default; for "remind me in 5min").
// Batch 1 is CRUD only — create / list / delete. The scheduler engine (batch 2) reads nextRunAt to fire and
// recomputes it for recurring tasks. Single store instance per main process.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dataDir } from '../../db/connection'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseSchedule, nextCronRun } from './cron'
// Types live in ipc/contracts — single source; the same shapes are the wire DTO and this service's model.
import type { ScheduledTask, CreateTaskInput, TaskRun } from '../../ipc/contracts'

const MAX_RUNS = 10 // recent fire results kept per task (newest first)

// Abuse guards mirroring the reference (Claude Code) scheduled-task model — see
// docs/studio-self-wakeup-cc-binary-extract.md §F.2. The model can self-create durable recurring tasks via
// schedule_create, so the count + age bounds below are what keep a runaway agent from filling the store with
// tasks that fire forever.
//   • MAX_ACTIVE_TASKS — reference `hXa = 50`: hard cap on active (enabled-or-disabled, non-expired) tasks;
//     creating beyond it is rejected, never silently dropped.
//   • RECURRING_MAX_AGE_MS — reference `recurringMaxAgeMs = 7*24*60*60*1000` (604800000 ms): a recurring task
//     older than this stops rescheduling and is removed instead of firing forever.
const MAX_ACTIVE_TASKS = 50
const RECURRING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 604800000

// A recurring task is expired once it is older than RECURRING_MAX_AGE_MS — UNLESS it is flagged `permanent`
// (explicit exemption from auto-expiry) or it has no `createdAt` (legacy persisted task whose age is unknown:
// the safe choice is to NEVER auto-delete it rather than guess an age and silently kill a user's durable task).
function isRecurringExpired(t: ScheduledTask, nowMs: number): boolean {
  if (!t.recurring || t.permanent) return false
  if (typeof t.createdAt !== 'number') return false // legacy task without createdAt → don't expire
  return nowMs - t.createdAt > RECURRING_MAX_AGE_MS
}

const FILE = join(dataDir(), 'scheduled_tasks.json')

// Session-only tasks (durable:false) — one array per main-process run.
const sessionTasks: ScheduledTask[] = []

function readDurable(): ScheduledTask[] {
  try {
    if (!existsSync(FILE)) return []
    const raw = JSON.parse(readFileSync(FILE, 'utf8')) as { tasks?: ScheduledTask[] }
    return Array.isArray(raw.tasks) ? raw.tasks : []
  } catch {
    return [] // corrupt/missing → treat as empty rather than crash the loop
  }
}

function writeDurable(tasks: ScheduledTask[]): void {
  mkdirSync(dirname(FILE), { recursive: true })
  writeFileSync(FILE, JSON.stringify({ tasks }, null, 2))
}

export class ScheduledTaskStore {
  // Listeners notified after a task mutation (create/delete) — index.ts broadcasts scheduled:changed to the
  // renderer so a task created via the schedule_* TOOL (which bypasses the IPC handlers + their reload) still
  // refreshes an open Scheduled page. Returns an unsubscribe fn.
  private changeListeners = new Set<() => void>()
  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb)
    return () => this.changeListeners.delete(cb)
  }
  private emitChange(): void {
    for (const cb of this.changeListeners) cb()
  }

  // Create a task. Parses the schedule into cron/one-shot + first nextRunAt; throws on an unparseable
  // schedule (the tool surfaces the message). durable → disk; else session-only.
  create(input: CreateTaskInput, nowMs: number): ScheduledTask {
    const parsed = parseSchedule(input.schedule, nowMs)
    if (!parsed) {
      throw new Error(
        `Could not parse schedule "${input.schedule}". Use an interval (5m / 2h / 1d), a one-shot time ` +
          `(2026-06-05T15:00), or a 5-field cron (0 9 * * 1-5).`
      )
    }
    if (!input.steps?.length) throw new Error('A scheduled task needs at least one step.')
    // Reject creation past the active-task cap (reference `hXa = 50`). Count tasks that still occupy a slot —
    // i.e. not already past auto-expiry — so a forgotten stale recurring task can't permanently wedge creation.
    const active = this.list().filter((t) => !isRecurringExpired(t, nowMs)).length
    if (active >= MAX_ACTIVE_TASKS) {
      console.warn(`[scheduler] rejected schedule_create "${input.name}" — active-task cap reached (${active}/${MAX_ACTIVE_TASKS})`)
      throw new Error(
        `Too many scheduled tasks (${active}/${MAX_ACTIVE_TASKS}). Delete an existing task before creating a new one.`
      )
    }
    const task: ScheduledTask = {
      id: randomUUID().slice(0, 8),
      name: input.name,
      cron: parsed.cron,
      nextRunAt: parsed.nextRunAt,
      recurring: parsed.recurring,
      durable: input.durable ?? false,
      enabled: true,
      steps: input.steps,
      cwd: input.cwd,
      creatorRoleId: input.creatorRoleId,
      creatorConvId: input.creatorConvId,
      createdAt: nowMs,
    }
    if (task.durable) {
      const tasks = readDurable()
      tasks.push(task)
      writeDurable(tasks)
    } else {
      sessionTasks.push(task)
    }
    this.emitChange()
    return task
  }

  list(): ScheduledTask[] {
    return [...readDurable(), ...sessionTasks]
  }

  get(id: string): ScheduledTask | undefined {
    return this.list().find((t) => t.id === id)
  }

  delete(id: string): boolean {
    const durable = readDurable()
    const di = durable.findIndex((t) => t.id === id)
    if (di >= 0) {
      durable.splice(di, 1)
      writeDurable(durable)
      this.emitChange()
      return true
    }
    const si = sessionTasks.findIndex((t) => t.id === id)
    if (si >= 0) {
      sessionTasks.splice(si, 1)
      this.emitChange()
      return true
    }
    return false
  }

  // Active tasks due to be scheduled, sorted by nextRunAt. The engine reads this each tick.
  loadActive(): ScheduledTask[] {
    return this.list()
      .filter((t) => t.enabled)
      .sort((a, b) => a.nextRunAt - b.nextRunAt)
  }

  // Flip a task's enable toggle (Scheduled page switch). A disabled task stays in the store but loadActive
  // skips it, so the engine never fires it. Returns false if the id isn't found.
  setEnabled(id: string, enabled: boolean): boolean {
    const apply = (tasks: ScheduledTask[], persist: () => void): boolean => {
      const t = tasks.find((x) => x.id === id)
      if (!t) return false
      t.enabled = enabled
      persist()
      return true
    }
    const durable = readDurable()
    if (apply(durable, () => writeDurable(durable))) {
      this.emitChange() // enable/disable changes what the engine should fire → re-arm + refresh the page
      return true
    }
    const ok = apply(sessionTasks, () => {})
    if (ok) this.emitChange()
    return ok
  }

  // Bind a task to a conversation (the engine calls this on a user-created unbound task's first fire, so
  // every later fire reuses the SAME "Scheduled · name" conversation instead of spawning a fresh orphan
  // each time — a stable anchor for the Tasks panel's Running row + accumulated history). Deliberately does
  // NOT emitChange: convId is not a schedule change, and this runs mid-fire where a re-arm would be noise.
  setConvId(id: string, convId: string): boolean {
    const apply = (tasks: ScheduledTask[], persist: () => void): boolean => {
      const t = tasks.find((x) => x.id === id)
      if (!t || t.convId) return false // never overwrite an existing binding
      t.convId = convId
      persist()
      return true
    }
    const durable = readDurable()
    if (apply(durable, () => writeDurable(durable))) return true
    return apply(sessionTasks, () => {})
  }

  // Edit a task in place (Scheduled page Save): re-parse the schedule (recomputing cron/nextRunAt/recurring)
  // and replace name/steps/cwd. Keeps id/createdAt/lastFiredAt/enabled/durable. Returns the updated task, or
  // null if the id isn't found or the schedule/steps are invalid.
  update(id: string, input: CreateTaskInput, nowMs: number): ScheduledTask | null {
    const parsed = parseSchedule(input.schedule, nowMs)
    if (!parsed || !input.steps?.length) return null
    const apply = (tasks: ScheduledTask[], persist: () => void): ScheduledTask | null => {
      const t = tasks.find((x) => x.id === id)
      if (!t) return null
      t.name = input.name
      t.steps = input.steps
      t.cwd = input.cwd
      t.cron = parsed.cron
      t.nextRunAt = parsed.nextRunAt
      t.recurring = parsed.recurring
      persist()
      return t
    }
    const durable = readDurable()
    const updated = apply(durable, () => writeDurable(durable)) ?? apply(sessionTasks, () => {})
    if (updated) this.emitChange() // schedule/steps changed → re-arm the engine + refresh the page
    return updated
  }

  // Advance the schedule BEFORE a run so the next tick can't re-fire a recurring task: recurring → recompute
  // nextRunAt from its cron. A one-shot keeps its nextRunAt and is deleted after the run by the engine.
  //
  // Auto-expiry (reference `recurringMaxAgeMs`): a recurring task older than RECURRING_MAX_AGE_MS must stop
  // rescheduling and be removed instead of firing forever. We do it here — the single point where a recurring
  // task would otherwise get its next nextRunAt — so an expired task is dropped before it can fire again.
  // Returns true if the task was expired (removed) so the engine can skip running it this tick.
  reschedule(id: string, nowMs: number): boolean {
    let expired = false
    const apply = (tasks: ScheduledTask[], persist: () => void): boolean => {
      const idx = tasks.findIndex((x) => x.id === id)
      if (idx < 0) return false
      const t = tasks[idx]
      if (isRecurringExpired(t, nowMs)) {
        tasks.splice(idx, 1) // older than the max age → remove instead of rescheduling
        persist()
        expired = true
        return true
      }
      const next = t.recurring && t.cron ? nextCronRun(t.cron, nowMs) : null
      if (next) {
        t.nextRunAt = next
        persist()
      }
      return true
    }
    const durable = readDurable()
    if (apply(durable, () => writeDurable(durable))) {
      if (expired) this.emitChange() // task removed → re-arm the engine + refresh the page
      return expired
    }
    apply(sessionTasks, () => {})
    if (expired) this.emitChange()
    return expired
  }

  // Record one execution AFTER the run: bump lastFiredAt + prepend the result to runs[] (capped). Makes a
  // background failure visible (result:'error' + reason) and links a run to its conversation (convId).
  recordRun(id: string, run: TaskRun, nowMs: number): void {
    const apply = (tasks: ScheduledTask[], persist: () => void): boolean => {
      const t = tasks.find((x) => x.id === id)
      if (!t) return false
      t.lastFiredAt = nowMs
      t.runs = [run, ...(t.runs ?? [])].slice(0, MAX_RUNS)
      persist()
      return true
    }
    const durable = readDurable()
    if (apply(durable, () => writeDurable(durable))) return
    apply(sessionTasks, () => {})
  }
}

export const scheduledTaskStore = new ScheduledTaskStore()
