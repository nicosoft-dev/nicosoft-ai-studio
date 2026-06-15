// Gate B — independent quality verification of a code-changing dispatched step, plus the FAIL closure
// loop. The verifier runs ONCE per gated step (the implementer already self-tests inside its own agent
// loop); a FAIL routes the verdict + evidence to the expert who OWNS the failing domain, who fixes the
// real defect or proves a false positive. Automatic re-work loops are Gate C's (e2e) job.

import * as rolesService from './roles.service'
import * as agentService from './agent-dispatch'
import * as memoryService from './memory.service'
import * as gateOutcomeRepo from '../repos/gate-outcome.repo'
import { displayName } from '../agent/roles/prompts'
import { deriveAcceptanceCriteria, route } from './coordinator-route'
import { gitHead, changedPathsSince, buildChangedSet } from './examine/diff'
import type { WrittenFile } from '../agent/context'
import { subjectMeta, type ReviewSubject } from './examine/subjects'
import { runBuildOnce } from './examine/build'
import { describeSnapshot, snapshotWorkspace } from './git-snapshot'
import { runRoleStep, type RunStepOptions } from './coordinator-step'
import { ulid } from '../db/id'
// Panel-examine §7 Phase 1: the fan-out primitive (subject fan-out + refute + summary) lives in examine/panel;
// the SHARED single verifier body lives in examine/verifier — the floor (runGatedRoleStep + closeDomain
// re-verify) and the panel both call the SAME runVerifierStep (never a copy → floor stays byte-identical).
import { runPanelExamine, subjectEvidence, type SubjectFinding } from './examine/panel'
import { runVerifierStep } from './examine/verifier'

// How the gated step ended. 'pass' = verifier approved the implementer's change directly. 'fixed' =
// verifier FAILed, the fail handler claimed a fix AND a re-verification confirmed it. 'false-positive' =
// the handler proved the verifier misjudged (carries its own evidence; not re-verified). 'unverified' =
// verification never actually judged the work (verifier infra failure, or no independent role bound) —
// the result is delivered but the caller MUST say so explicitly. 'unresolved' = everything else —
// handler produced no closure, or its claimed fix failed re-verification; MUST surface as an explicit
// failure, never a silent done (dogfood 2026-06-11: a zero-work handler sailed through).
// Closing-voice invariant the caller upholds: a gated step's conversation must END on the verifier's
// own report ('pass' / 'fixed') or an explicit coordinator verdict (everything else) — never on the
// implementer/handler's note, which reads as a normal done and hides the verification state.
export type GateOutcome = 'pass' | 'fixed' | 'false-positive' | 'unverified' | 'unresolved'
export type GatedStepResult = Awaited<ReturnType<typeof runRoleStep>> & { gateOutcome?: GateOutcome; gateEvidence?: string }

// --- Panel closure model (panel-examine §5, M4) -------------------------------------------------

// Severity ladder for the post-closure worst-of fold (§5.4): the STEP outcome is the most-alarming of the
// floor domain's outcome and every subject domain's outcome. "Can't call it done" (unresolved/unverified)
// outranks a confirmed close (fixed/false-positive/pass). unverified sits just under unresolved (a verifier
// that could not judge is worse than a confirmed fix) and above fixed.
const OUTCOME_SEVERITY: Record<GateOutcome, number> = {
  unresolved: 4,
  unverified: 3,
  fixed: 2,
  'false-positive': 1,
  pass: 0
}
function worstOf(outcomes: GateOutcome[]): GateOutcome {
  return outcomes.reduce<GateOutcome>((worst, o) => (OUTCOME_SEVERITY[o] > OUTCOME_SEVERITY[worst] ? o : worst), 'pass')
}

// Cost circuit-breaker (§5.5): the max failed domains a single step will actually close (handler + re-verify
// each). Floor(1) + subjects(≤|enum|) verdicts are already bounded; this caps the WRITE-heavy closure stage.
// ≤ |enum| by construction; a runaway backstop, never hit by a normal 1-3 failed-domain step. Domains beyond
// it are surfaced 'unresolved' (logged), never silently dropped.
const CLOSURE_DOMAIN_CAP = 6

// One failed domain needing closure: the floor (holistic) or a single failed subject dimension. Each carries
// ONLY its own failure evidence so its handler fixes its own defect, not a merged blob (§5.2).
interface FailedDomain {
  kind: 'floor' | 'subject'
  key?: ReviewSubject // subject domains only
  focus?: string // subject domains only — the re-verify persona's focus
  feedback: string // this domain's failure evidence
}
// The result of closing one domain (§5.4 input).
interface DomainClosure {
  kind: 'floor' | 'subject'
  key?: ReviewSubject
  handlerRoleId: string
  outcome: Extract<GateOutcome, 'fixed' | 'false-positive' | 'unresolved'>
  failureFeedback: string // the original domain failure (the learning loop's "verdict")
  evidence: string // the closure result (handler text or re-verify feedback)
  inputTokens: number
  outputTokens: number
}

export async function runGatedRoleStep(roleId: string, prompt: string, opts: RunStepOptions, gate: { enabled: boolean; originalPrompt: string; approvedPlan?: string; acceptance?: string[] }, signal?: AbortSignal): Promise<GatedStepResult> {
  if (!gate.enabled) return runRoleStep({ ...opts, roleId, prompt, signal: signal ?? opts.signal })

  // One ulid per gated step — links this step's floor row (and, post-M3/M4, its subject/aggregate rows) in
  // gate_outcomes (panel-examine §6). M1: only the floor row is written, tagged rowKind='floor'.
  const stepId = ulid()
  // M2 (panel-examine §3.2): record the implementer's STARTING commit + the paths ALREADY changed before
  // it runs (prior pipeline steps share one cwd with no commit between them + any pre-existing user edits),
  // so the content trigger can attribute ONLY this step's delta — not the union of all prior steps. Shadow
  // mode — selection is recorded for precision/recall; subjects don't run.
  const baseRef = await gitHead(opts.cwd)
  const baseChanged = await changedPathsSince(opts.cwd, baseRef)
  // Acceptance criteria, derived ONCE here and handed verbatim to implementer + verifier + fail handler
  // (one source of "what correct means" for the whole gated step). Empty on any failure → the gate runs
  // exactly as before. Outcome recording (gate_outcomes) is equally best-effort: stats must never be
  // able to void a delivered step.
  gate.acceptance = await deriveAcceptanceCriteria(gate.originalPrompt, signal ?? opts.signal)
  const criteriaBlock = gate.acceptance.length
    ? `\n\nAcceptance criteria (an independent verifier will check these — make each one true, and run the relevant checks yourself before finishing):\n${gate.acceptance.map((c) => `- ${c}`).join('\n')}`
    : ''
  const recordOutcome = (outcome: string, rounds: number, evidence: string): void => {
    try {
      gateOutcomeRepo.record({ convId: opts.convId, gate: 'B', roleId, outcome, rounds, evidence, rowKind: 'floor', stepId })
    } catch (e) {
      console.warn('[coordinator] gate outcome record failed:', e instanceof Error ? e.message : e)
    }
  }
  // M4 (panel-examine §6): a subject row carries that dimension's FINAL outcome (pass / fixed / false-positive
  // / unresolved); the aggregate row carries the step's worst-of fold. Both are EXCLUDED from the floor
  // pass-rate by the readers' WHERE row_kind='floor', so floor stats stay byte-identical.
  const recordSubjectOutcome = (subject: ReviewSubject, outcome: string, evidence: string): void => {
    try {
      gateOutcomeRepo.record({ convId: opts.convId, gate: 'B', roleId, outcome, rounds: 1, evidence, rowKind: 'subject', stepId, subject })
    } catch {
      /* stats best-effort */
    }
  }
  const recordAggregate = (outcome: string, rounds: number, evidence: string): void => {
    try {
      gateOutcomeRepo.record({ convId: opts.convId, gate: 'B', roleId, outcome, rounds, evidence, rowKind: 'aggregate', stepId })
    } catch {
      /* stats best-effort */
    }
  }
  // Panel card (panel-examine §4.4): re-emit each subject's FINAL resolved state — after refute + closure —
  // onto the panel card (id=panel-<stepId>, the same id runPanelExamine opened). Carries the structured
  // outcome / refute tally / fixed-by so the card row renders the final verdict + "→ fixed by X" without
  // re-parsing prose. A no-op when no panel ran (no card with that id exists → the orphan event is ignored).
  const panelId = `panel-${stepId}`
  const emitSubjectFinal = (lv: SubjectFinding, outcome: GateOutcome, handlerRoleId?: string): void => {
    opts.cb.onToolEvent?.(roleId, {
      type: 'sub_tool_done',
      toolUseId: `gate-b-subject-${lv.key}-${stepId}`,
      parentToolId: panelId,
      name: 'Subject',
      isError: outcome === 'unresolved' || outcome === 'unverified',
      input: { subject: lv.key, why: lv.why, mode: 'review', verdict: outcome, refuted: lv.refuted ?? false, refuteTally: lv.refuteTotal ? `${lv.refuteYes ?? 0}/${lv.refuteTotal}` : '', handlerName: handlerRoleId ? displayName(handlerRoleId) : '' },
      result: lv.refuteEvidence ? `${lv.feedback}\n[${lv.refuteEvidence}]` : lv.feedback
    })
  }
  const baseOpts: RunStepOptions = { ...opts, roleId, prompt: prompt + criteriaBlock, signal: signal ?? opts.signal }

  // bypass = full autonomy: skip the plan-review FRONT gate (Gate A) entirely and let the implementer execute
  // directly. Danny's oversight is the adversarial Gate B verification of the RESULT, not a plan-mode pre-check —
  // plan review only makes sense with an approver, and bypass has none (forcing plan + Gate A here was the
  // deadlock). Non-bypass keeps the plan stage so its ExitPlanMode still goes through Gate A review.
  // expectsFileChanges only on the bypass (executing) path — a plan-mode step's deliverable IS the plan.
  let result: Awaited<ReturnType<typeof runRoleStep>>
  if (opts.permissionMode === 'bypass') {
    result = await runRoleStep({ ...baseOpts, expectsFileChanges: true })
  } else {
    result = await runRoleStep({ ...baseOpts, permissionMode: 'plan' })
  }
  gate.approvedPlan = result.text

  // Gate B is an INDEPENDENT quality check, not a coordinator-driven fix loop: the implementer already
  // self-tests inside its own agent loop, so no blanket "retry N times" here. One verification of the
  // implementer's result; on FAIL, one fail-handler closure; the ONLY extra verifier pass is checking a
  // handler's "已修复/fixed" CLAIM — validating closure, not looping rework (rework loops are Gate C's job).
  const verdict = await runVerifierStep(roleId, opts, gate, result.text, signal)
  let inputTokens = result.inputTokens + verdict.inputTokens
  let outputTokens = result.outputTokens + verdict.outputTokens

  // Floor verifier infrastructure failure (LLM call failed / no verdict at all): there is no defect evidence
  // to act on, and the subjects share the SAME infra so they'd fail identically — skip the subject fan-out AND the
  // fail handler. Deliver unverified with a loud note (round8: a fully-green impl was wrongly declared "NOT
  // delivered"). Checked BEFORE the subject fan-out so a broken upstream never spends N more verifier calls.
  if (verdict.infraFailure) {
    console.warn(`[coordinator] gate-b verifier infrastructure failure — delivering unverified: ${verdict.feedback}`)
    recordOutcome('unverified', 1, verdict.feedback)
    return {
      ...result,
      inputTokens,
      outputTokens,
      gateOutcome: 'unverified',
      gateEvidence: verdict.feedback,
      text: `${result.text}\n\n[Independent verification could not run — result delivered UNVERIFIED. ${verdict.feedback}]`
    }
  }

  // M3 panel amplifier (panel-examine §4): the floor gave a real verdict (PASS/FAIL), so fan out the
  // content-triggered per-dimension subjects ON TOP of it. Each subject is an ADDITIVE read-only check sharing one
  // build; the floor verdict is never bypassed (§2 invariant). Best-effort: a degraded fan-out returns [] →
  // floor-only, exactly today's behavior.
  const subjectFindings = await runPanelExamine(roleId, opts, gate, result.text, stepId, baseRef, baseChanged, result.writtenFiles, signal)
  for (const lv of subjectFindings) {
    inputTokens += lv.inputTokens
    outputTokens += lv.outputTokens
  }
  // confirmed FAIL = produced, failed, AND not refuted by the skeptics → drives closure. A REFUTED subject is a
  // proven false alarm (recorded false-positive, folds as such); a DROPPED subject has no usable verdict (recorded
  // unverified, not folded). Neither enters closure.
  const failedSubjects = subjectFindings.filter((v) => v.produced && !v.passed && !v.refuted)
  const refutedSubjects = subjectFindings.filter((v) => v.produced && !v.passed && v.refuted)
  const droppedSubjects = subjectFindings.filter((v) => !v.produced)

  // PRE-closure gate (panel-examine §4.F step 3 / §5.1): floor-FAIL OR any-subject-FAIL → close the loop.
  // All-green (floor PASS + every subject PASS, or no subject) is a real pass; a SKIPPED floor keeps 'unverified'.
  if (verdict.passed && failedSubjects.length === 0 && refutedSubjects.length === 0) {
    const outcome: GateOutcome = verdict.skipped ? 'unverified' : 'pass'
    recordOutcome(outcome, 1, verdict.feedback)
    // Pure-green branch (no confirmed fail, no refuted fail): produced subject → 'pass'; dropped → 'unverified'
    // (kept so the selected set is reconstructable). Steps WITH a refuted subject take the unified path below.
    for (const lv of subjectFindings) {
      const oc: GateOutcome = lv.produced ? 'pass' : 'unverified'
      recordSubjectOutcome(lv.key, oc, subjectEvidence(lv))
      emitSubjectFinal(lv, oc)
    }
    // An ALL-GREEN panel step still gets an aggregate row (=outcome) so the M5 A/B reader counts it as an
    // amplified step — the denominator. A pure floor-only step (NO subject ran) gets NO aggregate row: it stays a
    // lone floor row, byte-identical to the single-verifier era (the subjectVsFloor join simply doesn't see it).
    if (subjectFindings.length > 0) {
      const ev = droppedSubjects.length ? `${verdict.feedback}\n[${droppedSubjects.length} subject(s) dropped/unverified: ${droppedSubjects.map((l) => l.key).join(', ')}]` : verdict.feedback
      recordAggregate(outcome, 1, ev)
    }
    return { ...result, inputTokens, outputTokens, gateOutcome: outcome, gateEvidence: verdict.skipped ? verdict.feedback : undefined }
  }

  // M4 per-domain closure (§5): the list of FAILED domains — the floor if it FAILed + each failed subject — each
  // carrying ONLY its own evidence so its handler fixes its OWN defect (§5.2), not a merged blob. This unifies
  // the M3 split (floor-PASS+subject-FAIL is no longer surfaced unresolved — it now gets a SAFE per-subject closure).
  // Circuit-breaker (§5.5): cap the write-heavy closure stage; domains beyond the cap are surfaced unresolved.
  const failedDomains: FailedDomain[] = []
  if (!verdict.passed) failedDomains.push({ kind: 'floor', feedback: verdict.feedback })
  for (const lv of failedSubjects) failedDomains.push({ kind: 'subject', key: lv.key, focus: subjectMeta(lv.key)?.focus ?? lv.key, feedback: lv.feedback })
  const domainsToClose = failedDomains.slice(0, CLOSURE_DOMAIN_CAP)
  if (failedDomains.length > domainsToClose.length) {
    console.warn(`[panel-examine] step ${stepId}: ${failedDomains.length} failed domains exceed cap ${CLOSURE_DOMAIN_CAP} — closing ${domainsToClose.length}, ${failedDomains.length - domainsToClose.length} surfaced unresolved (circuit-breaker §5.5)`)
  }

  // Snapshot ONLY when a handler will actually edit the tree (closure has domains). A floor-pass step whose
  // only subject FAILs were all refuted has no closure → no edits → no snapshot needed. Rollback point for the
  // handler's edits on top of the implementer's changes; recovery stays manual.
  const snap = domainsToClose.length > 0 ? await snapshotWorkspace(opts.cwd) : null
  if (snap) console.warn(`[coordinator] gate-b pre-fix workspace snapshot: ${describeSnapshot(snap)}`)

  // Closure runs SERIALLY across domains: handlers EDIT the shared working tree, so parallel handlers would
  // race/clobber each other (the subject fan-out could be parallel ONLY because subjects are read-only; closure
  // cannot). Deliberate departure from §4.F step-4's "pipeline" sketch — write-conflict safety wins, and §3.5
  // explicitly allows declaring the closure stage sequential. Each domain: its owning handler fixes its OWN
  // feedback, then a re-verify with the RIGHT persona (floor persona / that subject's focus over a fresh build).
  const closures: DomainClosure[] = []
  for (const domain of domainsToClose) {
    const dc = await closeDomain(roleId, opts, gate, result.text, domain, stepId, baseRef, baseChanged, result.writtenFiles, signal)
    inputTokens += dc.inputTokens
    outputTokens += dc.outputTokens
    closures.push(dc)
  }

  // Per-domain outcomes → rows. floor row = the floor domain's outcome (pass if floor passed, else its
  // closure); each subject row = that subject's FINAL outcome (pass if it passed, else its closure; a domain dropped
  // by the circuit-breaker → unresolved). The floor row stays FREE of subject influence (§2 invariant 3) — only
  // the aggregate folds them, so the floor pass-rate is byte-identical to the single-verifier era.
  const floorClosure = closures.find((c) => c.kind === 'floor')
  const floorDomainOutcome: GateOutcome = verdict.passed ? (verdict.skipped ? 'unverified' : 'pass') : (floorClosure?.outcome ?? 'unresolved')
  recordOutcome(floorDomainOutcome, floorClosure ? 2 : 1, floorClosure?.evidence ?? verdict.feedback)

  const subjectOutcomes: GateOutcome[] = []
  for (const lv of subjectFindings) {
    if (!lv.produced) {
      // dropped subject (no usable verdict): record 'unverified' for reconstructability, but DON'T fold it into
      // the aggregate — it has no verdict to fold. Keeps the M4 worst-of semantics while making it visible
      // that the dimension WAS selected (vs never triggered).
      recordSubjectOutcome(lv.key, 'unverified', subjectEvidence(lv))
      emitSubjectFinal(lv, 'unverified')
      continue
    }
    if (lv.passed) {
      recordSubjectOutcome(lv.key, 'pass', subjectEvidence(lv))
      emitSubjectFinal(lv, 'pass')
      subjectOutcomes.push('pass')
      continue
    }
    if (lv.refuted) {
      // adversarial refute proved a false alarm → 'false-positive' (not a fail, never closed); folds as such.
      recordSubjectOutcome(lv.key, 'false-positive', subjectEvidence(lv))
      emitSubjectFinal(lv, 'false-positive')
      subjectOutcomes.push('false-positive')
      continue
    }
    const lc = closures.find((c) => c.kind === 'subject' && c.key === lv.key)
    const subjectOutcome: GateOutcome = lc?.outcome ?? 'unresolved' // not closed (circuit-breaker) → unresolved
    // Keep the refute tally ("0-1/3 disproved → defect stands") on a confirmed-FAIL subject's row too, so the
    // gate_outcomes dump shows this FAIL survived the skeptics — not just that it was closed.
    const ev = lc?.evidence ?? subjectEvidence(lv)
    recordSubjectOutcome(lv.key, subjectOutcome, lv.refuteEvidence ? `${ev}\n[${lv.refuteEvidence}]` : ev)
    emitSubjectFinal(lv, subjectOutcome, lc?.handlerRoleId)
    subjectOutcomes.push(subjectOutcome)
  }

  // POST-closure worst-of fold (§5.4): the STEP outcome = the most-alarming of the floor domain + every subject
  // domain. Recorded as the aggregate row (row_kind='aggregate') — the step's real result, EXCLUDED from the
  // floor pass-rate by the readers' WHERE row_kind='floor'. fixed/unresolved only exist post-closure, so this
  // fold genuinely runs AFTER the closure loop (the §4.F ordering bug the doc audit caught).
  const aggregate = worstOf([floorDomainOutcome, ...subjectOutcomes])
  let aggregateEvidence = closures.map((c) => `[${c.kind === 'subject' ? `${c.key} subject` : 'floor'} — ${c.outcome}] ${c.evidence}`).join('\n\n') || verdict.feedback
  if (refutedSubjects.length) aggregateEvidence += `\n[${refutedSubjects.length} subject FAIL(s) refuted as false-positive: ${refutedSubjects.map((l) => l.key).join(', ')}]`
  if (droppedSubjects.length) aggregateEvidence += `\n[${droppedSubjects.length} subject(s) dropped/unverified: ${droppedSubjects.map((l) => l.key).join(', ')}]`
  if (aggregate === 'unresolved' && snap?.sha) aggregateEvidence += `\n[Pre-fix workspace snapshot available — ${describeSnapshot(snap)}]`
  // Aggregate row ONLY for steps that actually ran subjects: a floor-only FAIL→closure step (kill-switch off /
  // no changed paths / no independent verifier / degraded fan-out → subjectFindings=[]) has no subject to compare
  // against, so recording an aggregate would over-count it as "amplified" in the M5 A/B denominator and break
  // the "a pure floor-only step gets no aggregate row" invariant. Its floor row already carries the outcome.
  if (subjectFindings.length > 0) recordAggregate(aggregate, closures.length + 1, aggregateEvidence)
  console.log(`[coordinator] gate-b closure floor=${floorDomainOutcome} subjects=[${subjectOutcomes.join(',')}] aggregate=${aggregate}`)

  // Learning loop: distill each domain's confirmed fix / proven false positive (fire-and-forget). 'unresolved'
  // excluded — no confirmed root cause yet. Each closure learns from its OWN failure → fix pair, not a blob.
  for (const c of closures) {
    if (c.outcome === 'fixed' || c.outcome === 'false-positive') {
      void memoryService.learnFromGateClosure({ convId: opts.convId, roleId, task: gate.originalPrompt, verdict: c.failureFeedback, closure: c.evidence, kind: c.outcome })
    }
  }

  // Closing voice (§19-26 invariant): the step ends on the coordinator's per-domain verdict + the rework, not
  // the handler's own note. Each domain shows its outcome and the expert who handled it.
  const domainNote = closures.map((c) => `${c.kind === 'subject' ? `${c.key} subject` : 'floor'}: ${c.outcome}`).join(', ')
  return {
    ...result,
    inputTokens,
    outputTokens,
    gateOutcome: aggregate,
    gateEvidence: aggregateEvidence,
    text: `${result.text}\n\n[Independent verification — ${domainNote || aggregate}]\n\n${closures.map((c) => `[${c.kind === 'subject' ? `${c.key} subject` : 'floor'} → ${displayName(c.handlerRoleId)}]\n${c.evidence}`).join('\n\n')}`
  }
}

// After Gate B FAILs, Danny picks the expert who owns the failing domain. Reuses the router so the choice isn't
// hard-coded (frontend → Shuri, backend/logic → Flynn, etc.). Must resolve to a BOUND agent role that can run the
// loop + edit code; falls back to the implementer (always a bound agent role) when the router yields nothing
// usable (e.g. it answered 'direct' or picked an unbound role).
async function chooseFailHandler(feedback: string, gate: { originalPrompt: string }, implementerRoleId: string, signal?: AbortSignal): Promise<string> {
  const ask = [
    'An independent quality check FAILED a code change. Pick the ONE expert who should OWN the failure — fix the real defect, or prove it is a false positive — chosen by the domain the failure actually involves.',
    `Original task:\n${gate.originalPrompt}`,
    `Verification failure evidence:\n${feedback}`
  ].join('\n\n')
  try {
    const decision = await route(ask, [], signal)
    const picked = decision.mode === 'single' ? decision.role : decision.roles?.[0]
    if (picked && agentService.AGENT_ROLE_IDS.has(picked) && Boolean(rolesService.getBinding(picked)?.endpointId)) return picked
  } catch {
    /* router unavailable → fall back to the implementer below */
  }
  return implementerRoleId
}

// Gate B FAIL closure: the chosen expert handles the failure end-to-end and ends with an explicit conclusion, so
// no FAIL is ever left hanging. Runs the normal agent-loop dispatch (full kit → it can edit code on a real defect)
// under the implementer's working dir + permission mode, exactly like a regular dispatched step. The verifier is
// NOT re-run here (single pass, no retry loop — that's Gate C's territory); this is the missing follow-up handler.
async function runGateBFailFollowUp(
  implementerRoleId: string,
  opts: RunStepOptions,
  gate: { originalPrompt: string; approvedPlan?: string; acceptance?: string[] },
  implementationText: string,
  feedback: string,
  signal?: AbortSignal,
  idTag?: string
): Promise<{ handlerRoleId: string; text: string; inputTokens: number; outputTokens: number; writtenFiles: WrittenFile[] }> {
  const handlerRoleId = await chooseFailHandler(feedback, gate, implementerRoleId, signal)
  // Distinct per-domain stream identity when M4 closes multiple domains serially (idTag = domain+step); falls
  // back to a timestamp for a single-domain caller.
  const toolId = `gate-b-followup-${idTag ?? Date.now()}`
  opts.cb.onToolEvent?.(implementerRoleId, { type: 'sub_tool_start', toolUseId: toolId, parentToolId: 'coordinator-gate-b', name: 'GateBFailHandler', input: { handlerRoleId } })
  const handlerPrompt = [
    'Independent quality verification returned FAIL on the change below. As the responsible expert, CLOSE this out — never leave the FAIL dangling.',
    `Verification verdict + evidence:\n${feedback}`,
    `Original task:\n${gate.originalPrompt}`,
    gate.acceptance?.length ? `Acceptance criteria the change must satisfy:\n${gate.acceptance.map((c) => `- ${c}`).join('\n')}` : '',
    gate.approvedPlan ? `Plan the change was meant to follow:\n${gate.approvedPlan}` : '',
    `Implementation summary under review:\n${implementationText}`,
    'Decide and act:',
    '- REAL defect → fix it directly (edit the code), re-run the relevant checks, then state exactly what you fixed.',
    "- FALSE POSITIVE (the verifier misjudged — e.g. a same-named class, an expected empty diff, a check that doesn't apply) → DO NOT change code; list concrete evidence proving why, then pass it.",
    'END your message with exactly one final machine-parsed line — nothing after it: "CLOSURE: FIXED — <what you fixed>" or "CLOSURE: FALSE-POSITIVE — <the evidence>". The classifier reads only that line.'
  ].filter(Boolean).join('\n\n')
  const handler = await runRoleStep({
    ...opts,
    roleId: handlerRoleId,
    prompt: handlerPrompt,
    dispatch: [...(opts.dispatch ?? []), handlerRoleId],
    includeHistory: false,
    // The closure handler is expected to actually fix code on a real defect (a false positive is the
    // exception it must prove) — same action-displacement guard as the implementer.
    expectsFileChanges: true,
    signal: signal ?? opts.signal
  })
  opts.cb.onToolEvent?.(implementerRoleId, { type: 'sub_tool_done', toolUseId: toolId, parentToolId: 'coordinator-gate-b', name: 'GateBFailHandler', isError: false, result: handler.text || 'no output' })
  return { handlerRoleId, text: handler.text, inputTokens: handler.inputTokens, outputTokens: handler.outputTokens, writtenFiles: handler.writtenFiles }
}

// Close ONE failed domain end-to-end (panel-examine §5.2/§5.3, M4): dispatch the domain's owning handler
// to fix ITS defect (its OWN feedback only, never a merged blob), then re-verify the CLAIMED fix with the
// RIGHT persona — the floor persona for the floor domain (runs its own build), the failed subject's own focus for
// a subject domain (over a FRESH shared build, because the handler just edited the tree and the pre-closure build
// is now stale). Returns the domain's closure outcome (fixed / false-positive / unresolved).
async function closeDomain(
  implementerRoleId: string,
  opts: RunStepOptions,
  gate: { originalPrompt: string; approvedPlan?: string; acceptance?: string[] },
  implementationText: string,
  domain: FailedDomain,
  stepId: string,
  baseRef: string,
  baseChanged: string[],
  implementerFiles: readonly WrittenFile[],
  signal?: AbortSignal
): Promise<DomainClosure> {
  const idTag = domain.kind === 'subject' ? `subject-${domain.key}-${stepId}` : `floor-${stepId}`
  const followUp = await runGateBFailFollowUp(implementerRoleId, opts, gate, implementationText, domain.feedback, signal, idTag)
  let inputTokens = followUp.inputTokens
  let outputTokens = followUp.outputTokens
  const base = { kind: domain.kind, key: domain.key, handlerRoleId: followUp.handlerRoleId, failureFeedback: domain.feedback }
  // Contract-ONLY classification (memory: a verdict/closure must NEVER free-text scan — "not a false positive"
  // and "not fixed" both contain the trigger word and would mis-classify, polluting the false-positive stat).
  // The handler prompt mandates a final `CLOSURE: FIXED|FALSE-POSITIVE` line; if it's ABSENT the handler did not
  // close out per protocol → fall through to unresolved (fail-safe; dogfood 2026-06-11: a zero-work handler
  // must not pass silently).
  const closure = [...followUp.text.matchAll(/^\s*[#*>•-]*\s*CLOSURE:\s*(FIXED|FALSE[- ]?POSITIVE)\b/gim)].pop()?.[1]?.toUpperCase()
  if (closure?.startsWith('FALSE')) {
    return { ...base, outcome: 'false-positive', evidence: followUp.text, inputTokens, outputTokens }
  }
  if (closure === 'FIXED') {
    // Re-verify the claimed fix with the domain's OWN persona. floor → floor persona (runs its own build);
    // subject → that subject's focus over a FRESH shared build (the handler just changed the tree, so the build
    // captured before closure is stale). This is the §5.3 "re-verify with the failed subject's focus, not floor".
    let reVerdict: Awaited<ReturnType<typeof runVerifierStep>>
    if (domain.kind === 'subject' && domain.key && domain.focus) {
      // P1a end-to-end: scope the FRESH re-verify build's diff to THIS step's delta (implementer + the handler's
      // just-applied fix), so a prior pipeline step's edits don't bleed into the re-verify subject's ground truth —
      // the same de-contamination runPanelExamine does for the initial fan-out. Uses the git+event hybrid over BOTH
      // write sets (handler's content wins per path via last-write dedup), so the re-verify sees new/untracked
      // files git can't show — the greenfield coverage carries into closure too.
      const { changed: reChanged, diff: reDiff } = await buildChangedSet(opts.cwd, baseRef, baseChanged, [...implementerFiles, ...followUp.writtenFiles])
      const freshBuild = await runBuildOnce(opts.cwd, baseRef, reChanged, reDiff)
      // quiet: this re-verify reuses the subject's stable toolUseId; an event would overwrite the original
      // FAIL bubble the panel card keeps (the resolved outcome is re-emitted via emitSubjectFinal instead).
      reVerdict = await runVerifierStep(implementerRoleId, opts, gate, followUp.text, signal, { key: domain.key, focus: domain.focus, sharedBuild: freshBuild, stepId, quiet: true })
    } else {
      reVerdict = await runVerifierStep(implementerRoleId, opts, gate, followUp.text, signal)
    }
    inputTokens += reVerdict.inputTokens
    outputTokens += reVerdict.outputTokens
    return { ...base, outcome: reVerdict.passed ? 'fixed' : 'unresolved', evidence: reVerdict.feedback, inputTokens, outputTokens }
  }
  // No closure claim at all → unresolved (dogfood 2026-06-11: a zero-work handler must not pass silently).
  return { ...base, outcome: 'unresolved', evidence: followUp.text, inputTokens, outputTokens }
}
