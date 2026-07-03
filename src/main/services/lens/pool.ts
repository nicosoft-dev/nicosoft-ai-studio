// Studio Lens — the lens-flavored surface over the SHARED script pool (services/script/pool: the one
// global min(16, cores−2) semaphore every script-engine consumer runs under — Workflow-tool parity, queue
// never drop). Behavior identical to the pre-extraction lens pool; only the semaphore instance moved so
// workflow runs contend for the SAME machine-wide slots instead of multiplying them.

import { GLOBAL_MAX, withScriptSlot } from '../script/pool'

export { GLOBAL_MAX }

// Run ONE task under the single global cap (Workflow parity). QUEUE, never drop: the semaphore caps
// CONCURRENCY and runs excess as slots free — no task is ever dropped for being "too many" (the fan-out size is
// whatever the model's lens/candidate selection produced, and the limiter just paces it). A task that THROWS
// resolves to null (degrade, never reject the whole fan-out — the thunk-throw→null pattern), so one broken
// task can't void the others or the floor verdict.
export async function runExamineLimited<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await withScriptSlot(fn)
  } catch (e) {
    console.warn('[studio-lens] task threw, degrading (floor stands):', e instanceof Error ? e.message : e)
    return null
  }
}

// Fan a batch of tasks out under the limiter — concurrency-capped, queue the excess, each failure → null.
// A barrier (awaits all) returning a null-padded array the caller filters.
export function parallelExamineLimited<T>(tasks: Array<() => Promise<T>>): Promise<(T | null)[]> {
  return Promise.all(tasks.map((t) => runExamineLimited(t)))
}

// Run ONE LEAF op under the global cap, PROPAGATING throws (unlike runExamineLimited, which swallows to null).
// For a caller that must throttle a single agent call while NOT itself occupying a slot across an inner fan-out —
// e.g. the pipeline item throttles its finder leaf, then releases before its refute sub-fan-out acquires slots.
// This is the anti-deadlock rule: NEVER hold a slot here while awaiting more pool work (no nested acquire).
export function withLensSlot<T>(fn: () => Promise<T>): Promise<T> {
  return withScriptSlot(fn)
}
