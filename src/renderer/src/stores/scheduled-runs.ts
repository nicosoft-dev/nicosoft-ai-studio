/* ============================================================
   Live scheduled-task runs — retained app-wide (design doc §5).
   Folds the `scheduled:run:event` broadcast into one summary per RUNNING task for the workspace Tasks
   panel's Running section (same app-lifetime subscription pattern as workflow-runs: subscribe at module
   load so the panel shows current runs the moment it opens). A run is anchored to a conversation
   (anchorConvId — the creating role's conversation for agent-created tasks, else the conversation the
   chain runs in), so the panel shows only the runs that belong to the active conversation.
   ============================================================ */
import { create } from 'zustand'

// The event shape, derived from the preload bridge (no separate type import — one source of truth).
type SchedRunEvent = Parameters<Parameters<typeof window.api.scheduled.onRunEvent>[0]>[0]

export interface LiveScheduledRun {
  taskId: string
  name: string
  anchorConvId: string
  runConvId?: string
  trigger: 'schedule' | 'manual'
  stepIndex: number // 0-based index of the step currently running
  stepCount: number
  kind?: string // the current step's kind
}

interface ScheduledRunsState {
  running: Record<string, LiveScheduledRun> // keyed by taskId
}

export const useScheduledRuns = create<ScheduledRunsState>(() => ({ running: {} }))

// Fold one event into the running map: 'start' registers the run, 'step' advances the readout, 'settle'
// removes it. A 'step'/'settle' for a task we never saw start (renderer loaded mid-run) still registers
// so the panel doesn't miss it.
function apply(running: Record<string, LiveScheduledRun>, ev: SchedRunEvent): Record<string, LiveScheduledRun> {
  if (ev.phase === 'settle') {
    if (!running[ev.taskId]) return running
    const next = { ...running }
    delete next[ev.taskId]
    return next
  }
  // A 'start' is a fresh run — never inherit a prior run's step readout (a recurring task re-firing would
  // otherwise briefly show the previous run's k/n if a settle were ever missed). Only 'step' carries the
  // per-step fields, so it may fall back to what 'start' seeded.
  const prev = ev.phase === 'start' ? undefined : running[ev.taskId]
  return {
    ...running,
    [ev.taskId]: {
      taskId: ev.taskId,
      name: ev.name,
      anchorConvId: ev.anchorConvId,
      runConvId: ev.runConvId ?? prev?.runConvId,
      trigger: ev.trigger,
      stepIndex: ev.stepIndex ?? prev?.stepIndex ?? 0,
      stepCount: ev.stepCount,
      kind: ev.kind ?? prev?.kind,
    },
  }
}

// One app-lifetime subscription (never unsubscribed — it must outlive every Tasks-panel mount/unmount).
window.api.scheduled.onRunEvent((ev) => {
  useScheduledRuns.setState((s) => ({ running: apply(s.running, ev) }))
})
