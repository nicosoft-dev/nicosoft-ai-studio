import { ipcMain, shell } from 'electron'
import type { ComputerUseStatusDto } from './contracts'
import { getComputerUseStatus, setComputerUseEnabled } from '../services/computer-use'

// System Settings deep-links for the two TCC grants the helper needs. The panes are pre-filtered to the
// right privacy list; the user still flips the toggle themselves (macOS allows nothing less manual).
const PERMISSION_PANES: Record<string, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
}

export function registerComputerUseHandlers(): void {
  ipcMain.handle('computer-use:status', (): Promise<ComputerUseStatusDto> => getComputerUseStatus())
  ipcMain.handle(
    'computer-use:set-enabled',
    (_event, enabled: boolean): Promise<ComputerUseStatusDto> => setComputerUseEnabled(enabled === true)
  )
  ipcMain.handle('computer-use:open-settings', async (_event, pane: string) => {
    const url = PERMISSION_PANES[pane]
    if (!url) return { ok: false, error: `unknown permission pane "${pane}"` }
    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
