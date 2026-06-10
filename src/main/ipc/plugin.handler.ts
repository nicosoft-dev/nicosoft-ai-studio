import { BrowserWindow, dialog, ipcMain } from 'electron'
import * as pluginService from '../services/plugin.service'

// IPC boundary for plugins (Extensions → Plugins). install throws on a bad manifest / failed
// registration (after rolling back); the renderer surfaces the message.
export function registerPluginHandlers(): void {
  ipcMain.handle('plugins:list', () => pluginService.list())
  ipcMain.handle('plugins:install', (_e, dirPath: string) => pluginService.install(dirPath))
  ipcMain.handle('plugins:uninstall', (_e, id: string) => pluginService.uninstall(id))
  ipcMain.handle('plugins:toggle', (_e, id: string, enabled: boolean) => pluginService.setEnabled(id, enabled))
  // Folder picker for installing a plugin. Returns the chosen path, or null if cancelled.
  ipcMain.handle('plugins:pickDir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { title: 'Select a plugin folder (containing plugin.json)', properties: ['openDirectory' as const] }
    const res = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
}
