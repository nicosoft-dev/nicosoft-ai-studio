// AsyncRegistry (C3 §6.2) — a session-level registry of agent-launched async operations. An agent LAUNCHES a
// long / blocking / event-driven op (a long e2e run, a script, a custom condition) as a background handle, reports
// that it started, and later awaits it — so the op runs detached instead of blocking the launch call. Unlike
// AsyncSubAgentPool (persistent child agents) this wraps ANY Promise-returning runner as a uniform handle. Owned by
// the collaboration session (agent-collab) and torn down (dispose) when it ends; solo does not wire it this round
// (solo long ops stay synchronous — await_async is collab-only, see C3 §6.6 B2).

export interface AsyncHandle {
  id: string
  kind: 'lens' | 'e2e' | 'process' | 'service' | 'subagent' | 'custom'
  status: 'running' | 'done' | 'failed'
  info?: string // short human label of what was launched (shown in await/list results)
  result?: unknown // the runner's resolved value, set on 'done'
  error?: string // the failure message, set on 'failed'
}

// Module-level (process-global) so handle ids are unique across EVERY registry, not just within one. A solo
// direct-chat's registry (solo-async) is conv-level and PERSISTENT (it outlives runs), while a collaboration's
// (agent-collab) is per-session — so the same convId can, in principle, be backed by two registries. async:stopHandle
// locates a registry by convId and then stop()s by id; with a per-registry counter both would mint 'async-lens-1',
// and a collision could abort the WRONG op. A process-global counter makes every id unambiguous (each id lives in
// exactly one registry), so that lookup is provably safe WITHOUT relying on solo/collab routing being mutually
// exclusive. The id format is unchanged (async-<kind>-<n>); only the number is now global (nothing parses it).
let handleSeq = 0

export class AsyncRegistry {
  private handles = new Map<string, AsyncHandle>()
  // 批C2a: each launch's settle promise, so a SOLO caller can AWAIT one handle within its turn (await_async's solo
  // path). Collab instead wakes a parked expert via onComplete. The promise never rejects (the IIFE captures the
  // runner's throw as status:'failed'), so settle() always resolves to the settled handle.
  private settlers = new Map<string, Promise<void>>()
  // Per-handle abort controllers (批 P0 — Tasks-panel Stop). Each is chained to the shared `ac` below, so a
  // parentSignal abort / dispose() still fires EVERY handle's controller (whole-session tree-kill); stop(id) fires
  // only ONE. Without this the sole kill switch was `ac` (all-or-nothing) — a Tasks Stop had no way to end one op.
  private controllers = new Map<string, AbortController>()
  // Internal kill switch, chained to the owning session's signal. Both a real parentSignal abort AND dispose()
  // (called on a NORMAL quiescent session end, which does NOT abort parentSignal) fire it → every launch runner
  // sees its signal abort and tree-kills its background work (launch-async.ts onAbort). This MUST be independent
  // of parentSignal: a quiescent end never aborts that, and reusing it would leak an unawaited background process.
  private ac = new AbortController()
  // Completion hook: collab wires this to wake a parked expert when one of its in-flight handles finishes.
  onComplete?: (handle: AsyncHandle) => void

  constructor(parentSignal: AbortSignal) {
    if (parentSignal.aborted) this.ac.abort()
    else parentSignal.addEventListener('abort', () => this.ac.abort(), { once: true })
  }

  // Launch a background op. Returns the handle IMMEDIATELY (non-blocking); the runner resolves later, flipping
  // status to done/failed and firing onComplete. The runner gets the registry's INTERNAL signal (not parentSignal)
  // so dispose() on a normal session end cancels it too. A runner throw is captured as status:'failed' — it never
  // rejects into the session (a background fault must not crash it, mirroring CollabSession's per-expert isolation).
  launch(kind: AsyncHandle['kind'], info: string, runner: (signal: AbortSignal, id: string) => Promise<unknown>): AsyncHandle {
    const id = `async-${kind}-${++handleSeq}`
    const handle: AsyncHandle = { id, kind, status: 'running', info }
    this.handles.set(id, handle)
    // Per-handle controller so stop(id) can end THIS op alone. Chained to the shared `ac`: a parentSignal abort or
    // dispose() aborts it too (whole-session tree-kill preserved). The runner also receives `id` so it can tag its
    // progress (e.g. the lens panel card carries its handle id → the Tasks Stop button knows which handle to stop).
    const hc = new AbortController()
    if (this.ac.signal.aborted) hc.abort()
    else this.ac.signal.addEventListener('abort', () => hc.abort(), { once: true })
    this.controllers.set(id, hc)
    const settler = (async (): Promise<void> => {
      try {
        handle.result = await runner(hc.signal, id)
        handle.status = 'done'
      } catch (e) {
        handle.status = 'failed'
        handle.error = e instanceof Error ? e.message : String(e)
      }
      this.onComplete?.(handle)
    })()
    this.settlers.set(id, settler)
    return handle
  }

  get(id: string): AsyncHandle | undefined {
    return this.handles.get(id)
  }

  // Stop ONE running handle (Tasks-panel Stop for lens/research/design/migrate). Aborts only its own controller,
  // so its runner's onAbort reaps just that op; the settler captures the abort as status:'failed' and fires
  // onComplete like any normal settle. No-op (false) for an unknown / already-settled id — the other handles keep
  // running (unlike dispose(), which tree-kills all of them on session end).
  stop(id: string): boolean {
    const h = this.handles.get(id)
    if (!h || h.status !== 'running') return false
    this.controllers.get(id)?.abort()
    return true
  }

  // Await ONE handle's completion (SOLO within-turn await_async). Resolves to the settled handle (done/failed),
  // or undefined for an unknown id. Collab uses onComplete + the scheduler's park instead; solo has no scheduler,
  // so it awaits the settle promise directly inside the turn (the model is idle meanwhile — no token cost).
  async settle(id: string): Promise<AsyncHandle | undefined> {
    await this.settlers.get(id)
    return this.handles.get(id)
  }

  list(): AsyncHandle[] {
    return [...this.handles.values()]
  }

  // Tree-kill every still-running background op. agent-collab's finally calls this on session end (normal OR
  // aborted): aborting the internal signal makes each launch runner's onAbort reap its process group. Mirrors
  // ServiceRegistry.dispose() in the same finally — without it an unawaited launch_async process would leak past
  // the collaboration (a quiescent end never aborts parentSignal, so that can't be the cleanup hook).
  dispose(): void {
    this.ac.abort()
  }
}

// Render a handle as a one-line result string — shared by await_async (the tool result) and agent-collab's
// onComplete (the text injected when a parked expert resumes), so both read identically.
export function formatAsyncHandle(h: AsyncHandle): string {
  if (h.status === 'running') return `- ${h.id} (${h.kind}): still running${h.info ? ` — ${h.info}` : ''}`
  if (h.status === 'failed') return `- ${h.id} (${h.kind}): FAILED — ${h.error ?? 'unknown error'}`
  // A 'panel' handle's result is a StudioLensResult OBJECT — surface its readable .message (the verdict summary
  // the agent acts on), not a raw JSON dump. The driver awaits this handle in its OWN turn (the consolidated lens
  // review) and acts on it there; it is NOT threaded to the coordinator (the post-collab pass is Danny's separate Turing audit).
  if (h.kind === 'lens' && h.result && typeof h.result === 'object' && 'message' in h.result) {
    const msg = (h.result as { message?: unknown }).message
    return `- ${h.id} (panel): done — ${typeof msg === 'string' ? msg : '(panel produced no message)'}`
  }
  const r = typeof h.result === 'string' ? h.result : h.result != null ? JSON.stringify(h.result) : '(no result)'
  return `- ${h.id} (${h.kind}): done — ${r}`
}
