import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { dialog, ipcMain } from 'electron'

const execFileAsync = promisify(execFile)

// Project picker + git branch list / switch for Engineer's path selector (Claude-style chip row).
export function registerProjectHandlers(): void {
  // Open a native folder picker; returns the chosen absolute path or null if cancelled.
  ipcMain.handle('project:pick', async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  // Best-effort current branch from .git/HEAD. null when it's not a repo, is detached, or unreadable.
  ipcMain.handle('project:branch', async (_e, cwd: string): Promise<string | null> => {
    try {
      const head = await readFile(join(cwd, '.git', 'HEAD'), 'utf-8')
      const m = head.match(/ref:\s*refs\/heads\/(.+)/)
      return m ? m[1].trim() : null
    } catch {
      return null
    }
  })

  // List local branches. execFile (no shell) — branch names are never interpolated into a command.
  ipcMain.handle('project:branches', async (_e, cwd: string): Promise<string[]> => {
    try {
      const { stdout } = await execFileAsync('git', ['branch', '--format=%(refname:short)'], { cwd, timeout: 5_000 })
      return stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    } catch {
      return []
    }
  })

  // Switch branch. The branch comes from project:branches (git's own output) and execFile passes it as
  // a separate argv entry, so there's no shell-injection surface.
  ipcMain.handle('project:checkout', async (_e, cwd: string, branch: string): Promise<boolean> => {
    try {
      await execFileAsync('git', ['checkout', branch], { cwd, timeout: 10_000 })
      return true
    } catch {
      return false
    }
  })
}
