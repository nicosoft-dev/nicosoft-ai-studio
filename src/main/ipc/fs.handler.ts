import { ipcMain } from 'electron'
import * as filesService from '../services/workspace-files.service'

// IPC boundary for the workspace Files panel. Every channel takes (cwd, relPath): cwd is the root the
// renderer resolved for the active expert (cwdByExpert[role]); the service confines relPath under it via
// confineReal. No SQL, no path logic here. `shell:reveal` is the repurposed reveal channel (design §3 P25).
export function registerFsHandlers(): void {
  ipcMain.handle('fs:listDir', (_e, cwd: string, relPath: string) => filesService.listDir(cwd, relPath))
  ipcMain.handle('fs:readForView', (_e, cwd: string, relPath: string) => filesService.readForView(cwd, relPath))
  ipcMain.handle('fs:openDefault', (_e, cwd: string, relPath: string) => filesService.openDefault(cwd, relPath))
  ipcMain.handle('shell:reveal', (_e, cwd: string, relPath: string) => filesService.reveal(cwd, relPath))
}
