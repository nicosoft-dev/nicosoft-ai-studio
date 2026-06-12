import { ulid } from '../db/id'
import { getDb } from '../db/connection'

// gate_outcomes table. Pure SQL. One row per verification-gate closure — Gate B records how each gated
// step ended (pass / fixed / false-positive / unresolved / unverified), Gate C records each background
// e2e run's final verdict (PASS / FAIL / BLOCKED / SKIP). This is the measurement layer of the
// self-check loop: pass rates per implementer + outcome distributions feed Overview › Stats, so
// verification quality is a number, not an anecdote.

export type GateKind = 'B' | 'C'

export interface GateOutcomeInput {
  convId: string
  gate: GateKind
  roleId: string // implementer the gate judged
  outcome: string
  rounds: number
  evidence: string
}

const EVIDENCE_MAX = 500

export function record(input: GateOutcomeInput): void {
  getDb()
    .prepare(
      `INSERT INTO gate_outcomes (id, conv_id, gate, role_id, outcome, rounds, evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ulid(),
      input.convId,
      input.gate,
      input.roleId,
      input.outcome,
      input.rounds,
      input.evidence.slice(0, EVIDENCE_MAX),
      new Date().toISOString()
    )
}

export interface OutcomeCount {
  gate: GateKind
  outcome: string
  v: number
}

export function countByOutcome(): OutcomeCount[] {
  return getDb()
    .prepare(`SELECT gate, outcome, COUNT(*) v FROM gate_outcomes GROUP BY gate, outcome`)
    .all() as unknown as OutcomeCount[]
}

export interface RoleGateCount {
  roleId: string
  outcome: string
  v: number
}

// Gate B per-implementer outcome counts — the per-expert pass-rate source (Gate C runs are per-task
// e2e verdicts; attributing them to one implementer would mislead, so byExpert is B-only).
export function countByRole(): RoleGateCount[] {
  return getDb()
    .prepare(`SELECT role_id roleId, outcome, COUNT(*) v FROM gate_outcomes WHERE gate = 'B' GROUP BY role_id, outcome`)
    .all() as unknown as RoleGateCount[]
}
