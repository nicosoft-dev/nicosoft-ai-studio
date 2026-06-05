import { ipcMain } from 'electron'
import { scheduledTaskStore } from '../agent/scheduler/store'
import type { CreateTaskInput } from './contracts'

// Scheduled-task CRUD boundary (doc 28) — the Scheduled page's interface to the scheduler store. Thin: parse
// args, call the store, return — no business logic here. The engine (agent/scheduler/engine.ts) fires due
// tasks on its own 1s timer; this is only the management surface (list / create / edit / toggle / delete).
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
}
