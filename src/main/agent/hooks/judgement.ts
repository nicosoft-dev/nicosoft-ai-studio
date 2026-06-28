// hooks/judgement.ts — shared {ok, reason, impossible} parsing + outcome mapping for the two condition-judgement
// executors (prompt + agent). Centralizes the `impossible` safety valve: on a STOP-class event the model may
// declare the stop condition UNSATISFIABLE (impossible:true) so the runtime lets the agent stop instead of
// blocking it turn after turn until the consecutive-block breaker trips — the reference's explicit escape hatch
// for a condition that can never be met (e.g. one that references a capability that does not exist).

import type { HookOutcome } from './types'
import type { HookPayload } from './events'
import { eventMeta } from './events'

export interface Judgement {
  ok: boolean
  reason: string
  impossible: boolean
}

// Parse {ok, reason, impossible} from model text — tolerant of stray prose around the JSON object. FAILS CLOSED
// (ok=false) when no JSON object parses: the reply is model-generated over an attacker-influenceable payload, so
// prose is never read as an allow signal (a bare "ok"/"yes" inside a negation must not pass a deny gate).
export function parseJudgement(text: string, fallbackLabel: string): Judgement {
  const m = /\{[\s\S]*\}/.exec(text)
  if (m) {
    try {
      const j = JSON.parse(m[0]) as { ok?: unknown; reason?: unknown; impossible?: unknown }
      return { ok: j.ok === true, reason: typeof j.reason === 'string' ? j.reason : '', impossible: j.impossible === true }
    } catch {
      /* fall through to fail-closed */
    }
  }
  return { ok: false, reason: text.trim().slice(0, 500) || `${fallbackLabel} reply was not valid JSON`, impossible: false }
}

// Map a judgement to a HookOutcome, applying the event-class rules:
//   • impossible:true on a STOP-class event → success (let the agent stop; blocking would loop until the
//     consecutive-block breaker since the condition can never be met). The reason rides back as advisory context.
//   • ok:true  → success.
//   • ok:false → tool event: deny the call; stop-class: blocking (the engine turns it into a continuation
//     nudge); non-stop event with continueOnBlock: advisory context (don't veto the action).
export function judgementToOutcome(j: Judgement, payload: HookPayload, opts: { continueOnBlock?: boolean; label: string }): HookOutcome {
  const meta = eventMeta(payload.hook_event_name)
  if (j.impossible && meta.isStopClass) {
    return { outcome: 'success', additionalContext: j.reason ? `${opts.label}: stop condition reported unsatisfiable — ${j.reason}` : undefined }
  }
  if (j.ok) return { outcome: 'success' }
  const reason = j.reason || `${opts.label} condition not met`
  if (meta.isToolEvent) return { outcome: 'blocking', permissionBehavior: 'deny', hookPermissionDecisionReason: reason, blockingError: reason }
  if (!meta.isStopClass && opts.continueOnBlock) return { outcome: 'success', additionalContext: reason }
  return { outcome: 'blocking', blockingError: reason }
}
