// active-async.ts — convId → the AsyncRegistry currently backing a COLLABORATION's background handles, so the
// renderer can stop ONE running handle on demand (async:stopHandle → the Tasks-panel Stop on a running
// lens / research / design / migrate card). Mirrors active-services (convId → ServiceRegistry): the registry is
// a per-runCollabSession local, registered when the session starts and cleared in its finally — one active
// collaboration per conversation at a time.
//
// SOLO is deliberately NOT registered here: a direct-chat's async registry is the conv-level, PERSISTENT one
// owned by solo-async (it outlives runs so a parked turn can resume), reached directly via peekSoloAsync. The
// async:stopHandle handler tries this collab locator first, then falls back to the solo registry — safe even if a
// convId were backed by both, because handle ids are process-globally unique (async-registry's counter is
// module-level), so only one registry owns any given id.
import { BrowserWindow } from 'electron'
import type { AsyncRegistry } from '../agent/async-registry'
import type { ConvAsync } from '../ipc/contracts'

const active = new Map<string, AsyncRegistry>()

// conv:async broadcast — same all-windows convId-keyed pattern as conv:services (the registry's change
// hook fires from settlers with no WebContents in scope). Slim DTO: result/error payloads stay in main.
export function broadcastConvAsync(convId: string, reg: AsyncRegistry | undefined): void {
  const ev: ConvAsync = {
    convId,
    handles: (reg?.list() ?? []).map((h) => ({ id: h.id, kind: h.kind, status: h.status, info: h.info })),
  }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('conv:async', ev)
}

export function setActiveAsync(convId: string, reg: AsyncRegistry): void {
  active.set(convId, reg)
}
// Clear only if this exact registry is still the current one — a newer collaboration for the same conversation
// may have already replaced it, and that successor's registration must survive this session's finally (the same
// guard clearActiveServices uses).
export function clearActiveAsync(convId: string, reg: AsyncRegistry): void {
  if (active.get(convId) === reg) active.delete(convId)
}
export function activeAsyncFor(convId: string): AsyncRegistry | undefined {
  return active.get(convId)
}
