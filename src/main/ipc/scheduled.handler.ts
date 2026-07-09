import { ipcMain } from 'electron'
import { scheduledTaskStore } from '../agent/scheduler/store'
import { schedulerEngine } from '../agent/scheduler/engine'
import { pickFile } from './dialogs'
import type { CreateTaskInput } from './contracts'

// Scheduled-task CRUD boundary (doc 28) — the Scheduled page's interface to the scheduler store. Thin: parse
// args, call the store, return — no business logic here. The engine (agent/scheduler/engine.ts) fires due
// tasks event-armed on its own; this is only the management surface (list / create / edit / toggle / delete)
// plus the two run controls: fireNow (§4.5 manual trigger — /schedule <id>) and stopRun (Tasks panel Stop).
export function registerScheduledHandlers(): void {
  ipcMain.handle('scheduled:list', () => scheduledTaskStore.list())
  ipcMain.handle('scheduled:create', (_e, input: CreateTaskInput) => scheduledTaskStore.create(input, Date.now()))
  ipcMain.handle('scheduled:update', (_e, id: string, input: CreateTaskInput) =>
    scheduledTaskStore.update(id, input, Date.now()),
  )
  ipcMain.handle('scheduled:setEnabled', (_e, id: string, enabled: boolean) =>
    scheduledTaskStore.setEnabled(id, enabled),
  )
  ipcMain.handle('scheduled:delete', (_e, id: string) => scheduledTaskStore.delete(id))
  ipcMain.handle('scheduled:fireNow', (_e, id: string) => schedulerEngine.fireNow(id))
  ipcMain.handle('scheduled:stopRun', (_e, id: string) => schedulerEngine.stopRun(id))
  // A command step's Program mode picks an executable via the native file dialog.
  ipcMain.handle('scheduled:pickProgram', (e) => pickFile(e, { title: 'Choose a program' }))
}
