// Block 2 (Gate C) — the async background verification queue.
//
// This queue is DELIBERATELY decoupled from any single coordinator run. Unlike the sub-agent pool
// (which is owned by a run and dies when that run resolves), this queue has its OWN lifecycle: a job
// submitted here may take minutes and outlives the turn that submitted it. `run()` fires-and-forgets a
// task via `submit()` and returns immediately so `coordinator:done` fires and Danny ends his turn —
// the verdict is delivered later, asynchronously, through the task's own `onDone` callback.
//
// To avoid an import cycle, the queue imports NOTHING from coordinator.service.ts. The actual e2e
// verifier is INJECTED per task as `runVerify` — the queue only owns the scheduling + the FAIL→retry
// loop, never the verification logic.

// Gate C runs the verifier at most this many rounds: a FAIL loops back to the implementer to fix and
// re-verify; the 3rd consecutive FAIL stops and is flagged needsUser (Block 3 notifies the user).
export const GATE_C_MAX_ROUNDS = 3

// Four-value verdict — no partial pass (spec anti-reduction rule 3).
//   PASS    = the asserted checks genuinely passed.
//   FAIL    = a check failed / the task isn't satisfied (loops back to the implementer up to MAX_ROUNDS).
//   BLOCKED = the app / environment could not be launched, so nothing could be verified.
//   SKIP    = there is nothing to verify (no UI or API surface).
export type E2EVerdictKind = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP'

// The final verdict delivered to the submitter via onDone, with how many rounds it took. needsUser is
// set when the verifier exhausted MAX_ROUNDS still FAILing — Block 3 will surface that to the user.
export interface E2EVerdict {
  kind: E2EVerdictKind
  rounds: number
  detail: string
  needsUser?: boolean
}

// One round's result from the injected verifier executor.
export interface E2ERoundResult {
  kind: E2EVerdictKind
  detail: string
}

export interface VerifyTask {
  convId: string
  prompt: string
  cwd?: string
  // Injected executor: runs ONE verification round and returns its result. `round` is 1-based. The queue
  // owns the retry loop, not this function. Provided by the coordinator so the queue stays decoupled.
  runVerify: (round: number) => Promise<E2ERoundResult>
  // Called exactly once with the final verdict when the task is fully resolved (PASS/BLOCKED/SKIP, or
  // FAIL after MAX_ROUNDS). Fire-and-forget — the submitter does NOT await this.
  onDone: (verdict: E2EVerdict) => void
}

export class BackgroundVerifyQueue {
  private readonly queue: VerifyTask[] = []
  // The serial drain promise. One job runs at a time so concurrent e2e jobs never clash over ports or
  // the Electron instance. While a job runs this holds the in-flight promise; idle → null.
  private draining: Promise<void> | null = null

  // Fire-and-forget enqueue. Returns IMMEDIATELY — the caller must NEVER await this. Kicks the serial
  // worker if it isn't already draining.
  submit(task: VerifyTask): void {
    this.queue.push(task)
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null
      })
    }
  }

  // Serial worker: drains the queue one task at a time. Never throws — a thrown task is reported as a
  // BLOCKED verdict so the submitter always hears back.
  private async drain(): Promise<void> {
    let task: VerifyTask | undefined
    while ((task = this.queue.shift())) {
      let verdict: E2EVerdict
      try {
        verdict = await this.runTask(task)
      } catch (err) {
        verdict = {
          kind: 'BLOCKED',
          rounds: 0,
          detail: `Gate C crashed before producing a verdict: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      try {
        task.onDone(verdict)
      } catch {
        // onDone is the submitter's hook — never let its failure kill the worker / other queued jobs.
      }
    }
  }

  // Runs one task's verification loop: a FAIL loops back (the injected runVerify re-runs the implementer
  // + re-verifies) up to GATE_C_MAX_ROUNDS; PASS/BLOCKED/SKIP stop immediately.
  private async runTask(task: VerifyTask): Promise<E2EVerdict> {
    let last: E2ERoundResult = { kind: 'BLOCKED', detail: 'no rounds ran' }
    for (let round = 1; round <= GATE_C_MAX_ROUNDS; round++) {
      last = await task.runVerify(round)
      if (last.kind !== 'FAIL') {
        return { kind: last.kind, rounds: round, detail: last.detail }
      }
    }
    // Still FAIL after the last round → stop and flag for the user (Block 3 notifies).
    return { kind: 'FAIL', rounds: GATE_C_MAX_ROUNDS, detail: last.detail, needsUser: true }
  }
}

// Singleton — its lifecycle spans the whole process, independent of any coordinator run.
export const backgroundVerifyQueue = new BackgroundVerifyQueue()
