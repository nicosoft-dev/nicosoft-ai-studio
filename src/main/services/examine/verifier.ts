// Panel examine — the SHARED independent-verifier primitive (panel-examine §7 Phase 1). Extracted
// VERBATIM from coordinator-gate-b so the FLOOR verifier (runGatedRoleStep + closeDomain re-verify) and
// the PANEL fan-out (examine/panel.ts) call the IDENTICAL function — there is exactly ONE verifier body in
// the codebase. Copying it would let floor and panel drift and break floor byte-identity (Property A), so
// this module owns it and both sides import it. No behavior change vs the in-gate-b version.

import * as rolesService from '../roles.service'
import * as agentService from '../agent-dispatch'
import { COORDINATOR_VERIFIER_PROMPT, subjectExaminePrompt } from '../../agent/roles/prompts'
import { runRoleStep, type RunStepOptions } from '../coordinator-step'
import type { SharedBuild } from './build'
import type { ReviewSubject } from './subjects'

export function chooseVerifierRole(implementerRoleId: string): string {
  // The verifier runs the agent loop with an overridden read-only kit (Read/Grep/Glob/Bash) + the Gate B
  // verifier persona, so we only need an independent, BOUND agent role for its model/endpoint. It must be an
  // AGENT_ROLE (the coordinator has no agent-loop path — picking it would throw) and never the implementer.
  const order = ['analyst', 'engineer', 'shuri', 'generalist', 'scheduler', 'translator', 'editor', 'designer']
  return (
    order.find((r) => r !== implementerRoleId && agentService.AGENT_ROLE_IDS.has(r) && Boolean(rolesService.getBinding(r)?.endpointId)) ??
    'generalist'
  )
}

// Subject context for a panel verifier call (panel-examine §3.3/§3.4). ABSENT → the FLOOR verifier,
// byte-identical to before: full COORDINATOR_VERIFIER_PROMPT, Read/Grep/Glob/Bash kit, runs the build itself.
// PRESENT → an ADDITIVE per-dimension subject: derived persona, read-only kit (NO Bash), reasons over the shared
// build, distinct per-(subject,step) stream identity.
export interface SubjectContext {
  key: ReviewSubject
  focus: string
  sharedBuild: SharedBuild
  stepId: string
  // UI (panel-examine §4.4): when set, this subject's sub_tool event nests under the panel card (id=panelId)
  // instead of surfacing top-level; `why` is the selection reason shown on the row. Absent → top-level (the
  // floor verifier never sets these).
  panelId?: string
  why?: string
  // closeDomain re-verify: confirm the claimed fix WITHOUT emitting a duplicate subject bubble (it reuses the
  // subject's stable toolUseId, so an event would clobber the original FAIL row the card needs to keep).
  quiet?: boolean
}

export async function runVerifierStep(implementerRoleId: string, opts: RunStepOptions, gate: { originalPrompt: string; approvedPlan?: string; acceptance?: string[] }, implementationText: string, signal?: AbortSignal, subject?: SubjectContext): Promise<{ passed: boolean; feedback: string; inputTokens: number; outputTokens: number; infraFailure?: boolean; skipped?: boolean; contracted?: boolean }> {
  const verifierRoleId = chooseVerifierRole(implementerRoleId)
  // No independent agent role is bound besides the implementer → there's no one to verify. Don't FAIL/throw
  // the turn over a config gap; deliver the result with an explicit skipped marker so the caller labels
  // the outcome 'unverified' (never a silent pass).
  if (verifierRoleId === implementerRoleId) return { passed: true, skipped: true, feedback: 'Independent verification skipped: no independent verifier role bound (only the implementer is available); result delivered unverified.', inputTokens: 0, outputTokens: 0 }
  // Distinct stream identity (panel-examine §4-D): FLOOR keeps the `Date.now()` id; each SUBJECT gets a
  // stable per-(subject,step) id so N parallel subjects don't collide in the live event stream (a shared
  // `Date.now()` could fire in the same millisecond). The display name disambiguates the bubbles too.
  const toolId = subject ? `gate-b-subject-${subject.key}-${subject.stepId}` : `gate-b-verifier-${Date.now()}`
  const toolName = subject ? 'Subject' : 'IndependentVerifier'
  // Subject events nest under the panel card (parentToolId=panelId) when the caller is the panel fan-out; the
  // FLOOR keeps 'coordinator-gate-b' (no match → surfaces as its own top-level verifier card), byte-identical
  // to before. A quiet re-verify (closeDomain) emits nothing so it can't clobber the original subject row.
  const parentToolId = subject?.panelId ?? 'coordinator-gate-b'
  const emitEvents = !subject?.quiet
  if (emitEvents) opts.cb.onToolEvent?.(implementerRoleId, { type: 'sub_tool_start', toolUseId: toolId, parentToolId, name: toolName, input: subject ? { verifierRoleId, subject: subject.key, mode: 'review', why: subject.why ?? '' } : { verifierRoleId } })
  // Persona + how-to-verify live in the system-prompt override; this user message carries only the case to
  // judge. FLOOR: detect the project's own toolchain and run the build itself — stack-agnostic on purpose (a
  // hard-coded npm command sent a Go-repo verifier chasing a nonexistent package.json, dogfood 2026-06-11).
  // SUBJECT: the diff + build output are PROVIDED (shared once, §3.4) — it must NOT re-run the build (N subjects
  // racing the same tree → phantom red); it reasons over the provided output + read-only code inspection.
  const verifierPrompt = subject
    ? [
        `Run your "${subject.key}" subject on the change below. The diff and the project's build output are PROVIDED — do NOT re-run the build; reason over them and use Read / Grep / Glob to inspect the touched code for your dimension. End your message with exactly one final line \`VERDICT: PASS\` or \`VERDICT: FAIL\`.`,
        `Original task:\n${gate.originalPrompt}`,
        gate.acceptance?.length ? `Acceptance criteria the change must satisfy:\n${gate.acceptance.map((c) => `- ${c}`).join('\n')}` : '',
        subject.sharedBuild.diff ? `Diff under review (this step's changes):\n\`\`\`diff\n${subject.sharedBuild.diff}\n\`\`\`` : '',
        subject.sharedBuild.ran ? `Build / typecheck output (already run for all subjects — do NOT re-run it):\n\`\`\`\n${subject.sharedBuild.output}\n\`\`\`` : 'No build output is available — judge from the diff plus your own read-only code inspection.',
        `Implementer role (do NOT defer to them): ${implementerRoleId}`,
        `Implementer's own summary (a claim to verify, not ground truth):\n${implementationText}`
      ].filter(Boolean).join('\n\n')
    : [
        'Verify the change below as an independent reviewer. Inspect the diff (Bash `git diff`, Read the touched files), detect the project\'s own toolchain (go.mod → `go build ./...` + `go vet ./...`; package.json → `npm run typecheck`/`npm run build`; Cargo.toml → `cargo check`; etc.), run the relevant build/checks and the tests the task demands, report your evidence, then END your message with exactly one final line `VERDICT: PASS` or `VERDICT: FAIL` — the classifier reads only that line.',
        `Original task:\n${gate.originalPrompt}`,
        gate.acceptance?.length ? `Acceptance criteria — check each of these FIRST (they were given to the implementer as the definition of done), then run the toolchain checks:\n${gate.acceptance.map((c) => `- ${c}`).join('\n')}` : '',
        gate.approvedPlan ? `Approved plan the change must match:\n${gate.approvedPlan}` : '',
        `Implementer role (do NOT defer to them): ${implementerRoleId}`,
        `Implementer's own summary (a claim to verify, not ground truth):\n${implementationText}`
      ].filter(Boolean).join('\n\n')
  let verifier: Awaited<ReturnType<typeof runRoleStep>>
  try {
    verifier = await runRoleStep({
      ...opts,
      roleId: verifierRoleId,
      prompt: verifierPrompt,
      dispatch: [...(opts.dispatch ?? []), verifierRoleId],
      // Inherit the run's permission mode (opts.permissionMode), same as the implementer: a bypass run's verifier
      // runs bypass too and skips the self-approve classifier entirely (execution.ts), so it can run the project's
      // build/vet/test checks unattended. Hard-coding 'default' here forced every bypass run's verifier through the
      // classifier — which hard-denied harmless verification commands (e.g. `go test … >/dev/null`). The kit is
      // already read-only (toolNames below: no Write/Edit), so inheriting bypass adds no write capability.
      includeHistory: false,
      // FLOOR kit = Read/Grep/Glob + Bash so it can ACTUALLY run the checks (most non-dev roles lack Bash).
      // SUBJECT kit = Read/Grep/Glob, NO Bash — the build already ran (shared), and dropping Bash PHYSICALLY
      // enforces "a subject never re-builds / never starts a service" (§3.4 / §4-D), stronger than a prompt ask.
      // Both use the adversarial verifier persona, not the borrowed role's "don't touch code" system prompt.
      toolNames: subject ? ['Read', 'Grep', 'Glob'] : ['Read', 'Grep', 'Glob', 'Bash'],
      systemPromptOverride: subject ? subjectExaminePrompt(subject.focus) : COORDINATOR_VERIFIER_PROMPT,
      signal: signal ?? opts.signal
    })
  } catch (err) {
    // The verifier's own LLM call failed (e.g. upstream empty-response / channel fault — round8). That is
    // an infrastructure failure, not a verdict: report it as such so the caller skips the fail handler.
    const msg = err instanceof Error ? err.message : String(err)
    const feedback = `verifier LLM call failed: ${msg}`
    if (emitEvents) opts.cb.onToolEvent?.(implementerRoleId, { type: 'sub_tool_done', toolUseId: toolId, parentToolId, name: toolName, isError: true, result: feedback })
    return { passed: false, feedback, inputTokens: 0, outputTokens: 0, infraFailure: true }
  }
  const text = verifier.text.trim()
  // Contracted verdict line first: persona + user message both demand a FINAL `VERDICT: PASS|FAIL`
  // line, and the classifier reads only that (last match wins = final-line semantics). Free-text token
  // scanning is the fallback for a non-compliant reply only, fail-closed (PASS && !FAIL) — it MUST NOT
  // be the primary path: dogfood 2026-06-12 had two clear-PASS verdicts flipped to FAIL because the
  // evidence prose contained the brief's own term "fail-open", voiding a fully-green delivery. `contracted`
  // is also the subject-retry signal (runPanelExamine): a non-contracted subject reply is retried once, then dropped.
  const contracted = [...text.matchAll(/^\s*[#*>•-]*\s*VERDICT:\s*(PASS|FAIL)\b/gim)].pop()?.[1]
  const passed = contracted ? contracted.toUpperCase() === 'PASS' : /\bPASS\b/i.test(text) && !/\bFAIL\b/i.test(text)
  if (emitEvents) opts.cb.onToolEvent?.(implementerRoleId, { type: 'sub_tool_done', toolUseId: toolId, parentToolId, name: toolName, isError: !passed, result: text })
  // Empty text = the verifier ran but produced nothing (belt to the loop's empty-turn guard) — that is
  // an absent verdict, not a FAIL with evidence; mark infra so the caller doesn't dispatch the handler.
  return { passed, feedback: text || 'Verifier returned no verdict.', inputTokens: verifier.inputTokens, outputTokens: verifier.outputTokens, infraFailure: text ? undefined : true, contracted: Boolean(contracted) }
}
