import { ipcMain, BrowserWindow } from 'electron'
import { monitorService } from '../services/monitor.service'
import { selfRhythmService } from '../services/self-rhythm.service'

// Session-watcher management boundary — Monitors (Scheduled page + Tasks panel) and self-rhythm wakeups
// (Tasks panel Background section). Thin: list the active watchers and stop/cancel one by id. Probing /
// diffing / wakeups all live in their services. monitor:changed broadcasts on every start/stop/change so
// consumers refetch live; rhythm:changed is broadcast by self-rhythm.service itself on arm/fire/cancel.
export function registerMonitorHandlers(): void {
  ipcMain.handle('monitor:list', () => monitorService.list())
  ipcMain.handle('monitor:stop', (_e, id: string) => monitorService.stop(id, { reason: 'manual' }))
  ipcMain.handle('rhythm:list', (_e, convId: string) => selfRhythmService.list(convId))
  ipcMain.handle('rhythm:cancel', (_e, id: string) => selfRhythmService.cancel(id, { reason: 'manual' }))
  monitorService.subscribe(() => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('monitor:changed')
  })
}
