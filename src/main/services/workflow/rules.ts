// Workflow run rules — the PURE semantics of a run, carved into a leaf module (lens/runstep.ts precedent)
// so they unit-test off-Electron: the executor itself drags coordinator/step → agent-dispatch → Electron
// and can never load in a bare-Node harness. No imports beyond types + the shared script core.

import { isAgentCapError } from '../script/executor'
import type { WorkflowFailReason, WorkflowParamDto, WorkflowRunStatus } from '../../ipc/contracts'

// Stall watchdog budget per step — the lens sub-agent value (LENS_STALL_MS): 10 minutes of ZERO stream
// events (the watchdog pauses while tools execute) before the step is aborted as frozen.
export const WORKFLOW_STALL_MS = 600_000
// Workflow parity (cc GKa=5): re-run a STALLED step up to this many times before the run classifies failed.
export const STALL_RETRIES = 5

// The step-context wrap prefixed to every agent() prompt — fixes the step's voice (its final text returns
// to the SCRIPT, it is not chat) without touching the role's own system prompt. Pinned by e2e.
export function stepContextWrap(workflowName: string, phase: string | null): string {
  return (
    `You are executing one step of the saved workflow "${workflowName}"` +
    (phase ? ` (phase: ${phase})` : '') +
    '. Do the task below; your final text is returned to the workflow script as this step\'s result — ' +
    'output the result itself, not a chat message, and no "Done." preamble.\n\n'
  )
}

// The effective step cwd: run 'folder' param > meta.cwd > none (workflow-design §3.1 priority). The
// FIRST folder-typed param is the run-level override slot.
export function effectiveCwd(
  workflow: { params: WorkflowParamDto[]; cwd: string | null },
  params: Record<string, string | number | boolean>
): string | undefined {
  const folderParam = workflow.params.find((p) => p.type === 'folder')
  const fromRun = folderParam ? params[folderParam.name] : undefined
  if (typeof fromRun === 'string' && fromRun.trim()) return fromRun.trim()
  return workflow.cwd ?? undefined
}

export type StepFailure = { kind: Extract<WorkflowFailReason, 'step-error' | 'stalled'>; label: string; message: string }

// The §4.2 fail classification: user Stop wins ('stopped'), then ok; a failure is 'backstop' when the
// engine's lifetime cap threw, the recorded step failure's kind ('stalled'/'step-error') when the script
// rejected WITH that step's message (uncaught propagation — a caught-and-replaced error no longer matches
// and correctly reads as the script's own), else 'script-error'.
export function classifyRunOutcome(
  aborted: boolean,
  result: { ok: true } | { ok: false; error: string },
  lastFailure: StepFailure | null
): { status: Exclude<WorkflowRunStatus, 'running'>; failReason: WorkflowFailReason | null; failDetail: string | null } {
  if (aborted) return { status: 'stopped', failReason: null, failDetail: null }
  if (result.ok) return { status: 'ok', failReason: null, failDetail: null }
  if (isAgentCapError(result.error)) return { status: 'failed', failReason: 'backstop', failDetail: result.error }
  if (lastFailure && result.error.includes(lastFailure.message)) {
    return { status: 'failed', failReason: lastFailure.kind, failDetail: `${lastFailure.label}: ${lastFailure.message}` }
  }
  return { status: 'failed', failReason: 'script-error', failDetail: result.error }
}
