// async.handler.ts — renderer-driven Stop of ONE background async handle: the Tasks-panel Stop on a running
// lens (research / design / migrate follow the same async-park pattern in later batches). Product rule
// (research-role-driven-redesign §4.6): chat stops chat (.cmp-stop stops the turn), tasks stop tasks — a parked
// background handle is reached HERE, not by the composer.
//
// The registry is a per-run local: a collaboration's is exposed via active-async, a solo direct-chat's is the
// persistent conv-level one owned by solo-async. Try the collab locator first, then fall back to solo. This is safe
// even if a convId were ever backed by both: handle ids are process-globally unique (async-registry's counter is
// module-level), so at most ONE registry owns any given id and the first stop() that finds it is the right one.
// No-op (false) when neither has it (unknown / already-settled id, or no active registry for the conv).
import { ipcMain } from 'electron'
import { activeAsyncFor } from '../services/active-async'
import { peekSoloAsync } from '../services/solo-async'

export function registerAsyncHandlers(): void {
  ipcMain.handle('async:stopHandle', (_e, convId: string, handleId: string): boolean => {
    if (activeAsyncFor(convId)?.stop(handleId)) return true
    return peekSoloAsync(convId)?.reg.stop(handleId) ?? false
  })
}
