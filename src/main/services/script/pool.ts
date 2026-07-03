// Studio script pool — the ONE global agent-concurrency semaphore shared by every script-engine consumer
// (lens reviews + workflow runs). Exactly like the Claude Code Workflow tool: concurrent agent() calls cap
// at min(16, cores−2), excess QUEUES (never dropped) and runs as slots free; there is NO per-endpoint
// sub-cap. One machine-wide instance on purpose — a lens fan-out and a workflow run contend for the same
// LLM concurrency budget instead of multiplying it.

import { cpus } from 'node:os'

function globalConcurrency(): number {
  let cores = 4
  try {
    cores = cpus().length
  } catch {
    cores = 4
  }
  // The Workflow tool's form, Math.min(16, Math.max(2, cores-2)) — clamp to
  // [2,16], a floor of 2 (not 1) so even a 1-2 core box still fans two agents out.
  return Math.min(16, Math.max(2, cores - 2))
}

export const GLOBAL_MAX = globalConcurrency()

// Minimal async semaphore. acquire() takes a slot or queues a resolver; release() hands the freed slot
// DIRECTLY to the next waiter (active count unchanged across the handoff) or frees it when none wait.
class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) next() // hand the slot to the next waiter; active stays the same
    else this.active--
  }
}

const globalSem = new Semaphore(GLOBAL_MAX)

// Run ONE LEAF op under the global cap, PROPAGATING throws. The anti-deadlock rule: NEVER hold a slot
// here while awaiting more pool work (no nested acquire) — acquire at the leaf agent call only, exactly
// like the Workflow tool (parallel/pipeline fire thunks; the semaphore wraps each individual spawn).
export function withScriptSlot<T>(fn: () => Promise<T>): Promise<T> {
  return globalSem.run(fn)
}
