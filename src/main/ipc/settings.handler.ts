import { ipcMain } from 'electron'
import * as settingsService from '../services/settings.service'

// IPC boundary for settings (profile / general / privacy key-value).
export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', (_e, key: string) => settingsService.get(key))
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => settingsService.set(key, value))
}
