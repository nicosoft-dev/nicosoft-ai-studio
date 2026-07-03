/* ============================================================
   Live workflow runs — retained app-wide (workflow-design §6.4, W2④).
   Folds the `workflow:run:event` broadcast into one summary per RUNNING run for the Tasks panel's
   "Workflows" section (same app-lifetime subscription pattern as conv-todos: subscribe at module load so
   the panel shows current runs the moment it opens). Runs are GLOBAL background work — not tied to the
   active conversation. A renderer (re)load mid-run is re-seeded from the run rows; live events then keep
   it fresh (at worst the seed lags until the next per-step status re-broadcast).
   ============================================================ */
import { create } from 'zustand'
import { applyRunEvent, seedRun, type LiveWorkflowRun } from '@/lib/workflow-runs-model'

interface WorkflowRunsState {
  running: Record<string, LiveWorkflowRun>
}

export const useWorkflowRuns = create<WorkflowRunsState>(() => ({ running: {} }))

// Workflow display meta (name + step count), cached from workflows.list(). An event for an id we don't
// know yet (workflow created after load) gets placeholders and triggers ONE refresh that patches entries.
const meta: Record<string, { name: string; steps: number }> = {}
let refreshing = false
function refreshMeta(): void {
  if (refreshing) return
  refreshing = true
  void window.api.workflows
    .list()
    .then((ws) => {
      for (const w of ws) meta[w.id] = { name: w.name, steps: w.steps }
      useWorkflowRuns.setState((s) => {
        const running = { ...s.running }
        for (const r of Object.values(running)) {
          const m = meta[r.workflowId]
          if (m && (!r.name || !r.steps)) running[r.runId] = { ...r, name: m.name, steps: m.steps }
        }
        return { running }
      })
    })
    .finally(() => {
      refreshing = false
    })
}
const metaOf = (workflowId: string): { name: string; steps: number } => {
  const m = meta[workflowId]
  if (!m) refreshMeta()
  return m ?? { name: '', steps: 0 }
}

// One app-lifetime subscription (never unsubscribed — it must outlive every Tasks-panel mount/unmount).
window.api.workflows.onRunEvent((ev) => {
  useWorkflowRuns.setState((s) => ({ running: applyRunEvent(s.running, ev, metaOf) }))
})

// Seed runs already in flight when this renderer loads (reload mid-run): the list's lastRun spots the
// workflow, its newest run row is the live one.
void window.api.workflows.list().then(async (ws) => {
  for (const w of ws) meta[w.id] = { name: w.name, steps: w.steps }
  for (const w of ws.filter((x) => x.lastRun?.status === 'running')) {
    const runs = await window.api.workflows.runs(w.id)
    const top = runs[0]
    if (top?.status === 'running') {
      useWorkflowRuns.setState((s) => ({
        running: seedRun(s.running, { runId: top.id, workflowId: w.id, name: w.name, steps: w.steps, originConvId: top.originConvId, inTokens: top.inTokens, outTokens: top.outTokens })
      }))
    }
  }
})
