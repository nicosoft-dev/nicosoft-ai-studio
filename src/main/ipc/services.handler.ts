// services.handler.ts — renderer-driven control of a conversation's live background services. The registry
// is a per-run local owned by agent-collab / agent-dispatch and exposed through active-services (convId →
// handle); these handlers reach it to list active services, read a service's logs, or stop one on demand.
// All no-op safely (empty / null / false) when no run is active for the conversation.
import { ipcMain } from 'electron'
import { activeServicesFor } from '../services/active-services'
import { sessionBus } from '../agent/session-bus'

export function registerServiceHandlers(): void {
  ipcMain.handle('services:list', (_e, convId: string) =>
    activeServicesFor(convId)?.list().filter((s) => s.status !== 'exited') ?? []
  )
  ipcMain.handle('services:logs', (_e, convId: string, id: string) =>
    activeServicesFor(convId)?.getLogs(id) ?? null
  )
  // Stopping from the panel notifies the agent (it planned around this service staying up — a dead dev
  // server it still believes in wastes its next turn). The agent's own stop_service reaches the registry
  // directly, not this handler, so it never hears an echo of its own stop.
  ipcMain.handle('services:stop', (_e, convId: string, id: string) => {
    const h = activeServicesFor(convId)
    const info = h?.list().find((s) => s.id === id)
    const ok = h?.stop(id) ?? false
    if (ok && info) {
      void sessionBus.inject(convId, {
        text:
          `Background service "${info.name}" (${info.command}) was stopped by the user from the Tasks panel. ` +
          'It is no longer running. Do not restart it unless the user asks you to.',
        source: `service:${id}`,
        priority: 'later',
        roleId: info.owner ?? undefined,
      })
    }
    return ok
  })
}
