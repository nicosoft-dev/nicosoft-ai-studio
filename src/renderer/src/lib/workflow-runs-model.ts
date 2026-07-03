/* ============================================================
   NicoSoft AI Studio — live workflow-run summaries (workflow-design §6.4, W2④)
   The pure reducer behind the Tasks panel's "Workflows" section: fold the `workflow:run:event` stream
   into one summary entry per RUNNING run (name · phase · current role · steps done · ↑tokens). No React,
   no window, no aliased value imports — the e2e harness pins the fold directly.
   ============================================================ */

export interface LiveWorkflowRun {
  runId: string
  workflowId: string
  name: string
  steps: number // static agent() call-site count (0 = unknown) — the x/y denominator
  stepsDone: number
  phase: string | null
  role: string | null // the most recently started step's role
  inTokens: number
  outTokens: number
}

// Structural view of the broadcast events (assignable from the preload's WorkflowRunEvent union).
export interface RunEventLike {
  kind: string
  runId: string
  workflowId?: string
  status?: string
  title?: string
  role?: string
  phase?: string | null
  inTokens?: number
  outTokens?: number
  ok?: boolean
}

// Fold ONE event. `metaOf` resolves a workflow id to its display meta (name + declared step count) from
// whatever cache the caller keeps — unknown ids get placeholders and the caller patches them later.
export function applyRunEvent(
  state: Record<string, LiveWorkflowRun>,
  ev: RunEventLike,
  metaOf: (workflowId: string) => { name: string; steps: number }
): Record<string, LiveWorkflowRun> {
  if (ev.kind === 'status') {
    if (ev.status === 'running') {
      const prev = state[ev.runId]
      const meta = metaOf(ev.workflowId ?? '')
      return {
        ...state,
        [ev.runId]: {
          runId: ev.runId,
          workflowId: ev.workflowId ?? prev?.workflowId ?? '',
          name: meta.name || (prev?.name ?? ''),
          steps: meta.steps || (prev?.steps ?? 0),
          stepsDone: prev?.stepsDone ?? 0,
          phase: prev?.phase ?? null,
          role: prev?.role ?? null,
          inTokens: ev.inTokens ?? prev?.inTokens ?? 0,
          outTokens: ev.outTokens ?? prev?.outTokens ?? 0
        }
      }
    }
    // settle (ok / failed / stopped) → the entry leaves the live section
    if (ev.runId in state) {
      const next = { ...state }
      delete next[ev.runId]
      return next
    }
    return state
  }
  const cur = state[ev.runId]
  if (!cur) return state // phase/step events for a run we never saw start (stale stream) — ignore
  if (ev.kind === 'phase') return { ...state, [ev.runId]: { ...cur, phase: ev.title ?? null } }
  if (ev.kind === 'step-start') return { ...state, [ev.runId]: { ...cur, role: ev.role ?? cur.role, phase: ev.phase ?? cur.phase } }
  if (ev.kind === 'step-done') return { ...state, [ev.runId]: { ...cur, stepsDone: cur.stepsDone + 1 } }
  return state
}

// Seed an entry for a run already in flight when the renderer (re)loads — status events will keep it fresh.
export function seedRun(
  state: Record<string, LiveWorkflowRun>,
  seed: { runId: string; workflowId: string; name: string; steps: number; inTokens?: number; outTokens?: number }
): Record<string, LiveWorkflowRun> {
  if (state[seed.runId]) return state // live events beat the seed — never regress a fresher entry
  return {
    ...state,
    [seed.runId]: {
      runId: seed.runId,
      workflowId: seed.workflowId,
      name: seed.name,
      steps: seed.steps,
      stepsDone: 0,
      phase: null,
      role: null,
      inTokens: seed.inTokens ?? 0,
      outTokens: seed.outTokens ?? 0
    }
  }
}
