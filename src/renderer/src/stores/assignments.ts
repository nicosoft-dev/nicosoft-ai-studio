/* ============================================================
   Assignment ledger cache, retained app-wide (conv-todos pattern).
   The main process broadcasts assignment:changed on every real transition (open / reopen / per-role
   settle / batch backstop); rows are small, so the store simply REFETCHES its two views instead of
   patching — one bounded burst-coalesced tick per change wave. Subscribing at module load (app lifetime)
   keeps the Overview's In-progress/Done sections warm even while the view is unmounted.
   ============================================================ */
import { create } from 'zustand'

export type AssignmentDto = Awaited<ReturnType<typeof window.api.assignments.list>>[number]

interface AssignmentsState {
  active: AssignmentDto[] // in_progress rows, newest started first
  settled: AssignmentDto[] // finished rows (done/failed/stopped), newest ENDED first — a bounded recent slice
}

export const useAssignments = create<AssignmentsState>(() => ({ active: [], settled: [] }))

// Enough for "Done today" plus the recent-10 fallback and the live cards' settled siblings; the
// Assignments tab (批3) fetches its own unbounded list.
const SETTLED_SLICE = 60

async function refetch(): Promise<void> {
  const [active, settled] = await Promise.all([
    window.api.assignments.list({ status: 'in_progress' }),
    window.api.assignments.list({ settled: true, limit: SETTLED_SLICE }),
  ])
  useAssignments.setState({ active, settled })
}

// One app-lifetime subscription; a collab batch opens/settles several rows back-to-back, so coalesce a
// change wave into a single refetch tick.
let pending: ReturnType<typeof setTimeout> | null = null
window.api.assignments.onChanged(() => {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    void refetch().catch(() => {})
  }, 120)
})
void refetch().catch(() => {})
