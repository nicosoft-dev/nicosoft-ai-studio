// Scheduled-task storage (batch 1 / doc 28). Two modes, ported from ccb:
//   • durable: true  → persisted to ~/.nsai/scheduled_tasks.json, survives restarts.
//   • durable: false → in-memory, lives only for this main-process run (default; for "remind me in 5min").
// Batch 1 is CRUD only — create / list / delete. The scheduler engine (batch 2) reads nextRunAt to fire and
// recomputes it for recurring tasks. Single store instance per main process.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseSchedule } from './cron'

export interface ScheduledTask {
  id: string // 8-hex, like ccb
  cron: string | null // recurring cron expr; null for a one-shot
  prompt: string // injected when it fires
  createdAt: number
  lastFiredAt?: number
  nextRunAt: number // epoch ms — the only field the engine schedules on
  recurring: boolean
  permanent?: boolean // exempt from auto-expiry (ccb)
  durable: boolean // true → disk; false → session-only
  roleId?: string // executor role (any role; defaults to scheduler at fire time)
  convId?: string // target conversation to inject into
  cwd?: string // pre-authorized working dir (full perms inside it when fired — doc 28 §5.1)
  status: 'active' | 'paused' | 'done' | 'expired'
}

export interface CreateTaskInput {
  schedule: string // interval (5m/2h/1d) | one-shot ISO | 5-field cron
  prompt: string
  roleId?: string
  cwd?: string
  durable?: boolean
}

const FILE = join(homedir(), '.nsai', 'scheduled_tasks.json')

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
    const task: ScheduledTask = {
      id: randomUUID().slice(0, 8),
      cron: parsed.cron,
      prompt: input.prompt,
      createdAt: nowMs,
      nextRunAt: parsed.nextRunAt,
      recurring: parsed.recurring,
      durable: input.durable ?? false,
      roleId: input.roleId,
      cwd: input.cwd,
      status: 'active',
    }
    if (task.durable) {
      const tasks = readDurable()
      tasks.push(task)
      writeDurable(tasks)
    } else {
      sessionTasks.push(task)
    }
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
      return true
    }
    const si = sessionTasks.findIndex((t) => t.id === id)
    if (si >= 0) {
      sessionTasks.splice(si, 1)
      return true
    }
    return false
  }
}

export const scheduledTaskStore = new ScheduledTaskStore()
