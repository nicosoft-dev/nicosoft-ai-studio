// conv → abort hooks for every LIVE run streaming into it, regardless of mode: solo agent runs
// (agent.handler), coordinator/collab UI runs (coordinator.handler), plain chat streams (chat.handler).
// conversation.service.remove aborts through this BEFORE deleting, so EVERY deletion path — direct conv
// delete, role delete, project 停删, plugin uninstall (which calls rolesService.remove with no IPC layer
// in sight) — stops live work first instead of leaving an agent burning tokens into deleted rows.
// Handler-agnostic on purpose: the IPC handlers register their own abort closures here (this module
// imports nothing), so the service layer can trigger them without a services→ipc layering inversion.

const liveRuns = new Map<string, Set<() => void>>()

// Register a live run's abort hook under its conversation. Returns the unregister — call it from the
// run's .finally() so a finished run can never be "aborted" later (the closure may pin a stream registry
// entry otherwise).
export function registerLiveRun(convId: string, abort: () => void): () => void {
  let set = liveRuns.get(convId)
  if (!set) liveRuns.set(convId, (set = new Set()))
  set.add(abort)
  return () => {
    set.delete(abort)
    if (set.size === 0 && liveRuns.get(convId) === set) liveRuns.delete(convId)
  }
}

// Abort every live run consuming this conversation. Snapshot before iterating — an abort synchronously
// unwinding into its own unregister must not mutate the set mid-loop. Best-effort per run: one broken
// abort hook must not shield the others (or block the deletion this call precedes).
export function abortLiveRuns(convId: string): void {
  for (const abort of [...(liveRuns.get(convId) ?? [])]) {
    try {
      abort()
    } catch (e) {
      console.warn('[live-runs] abort hook failed:', e instanceof Error ? e.message : e)
    }
  }
}

// Introspection for tests/diagnostics: how many live runs are registered for this conv right now.
export function liveRunCount(convId: string): number {
  return liveRuns.get(convId)?.size ?? 0
}
