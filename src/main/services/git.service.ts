import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Read-only git helpers backing Engineer's path-selector branch chip. The IPC handler is a thin
// pass-through to these. All run via execFile (NO shell): branch names come from git's own output and are
// passed as separate argv entries, so there is no shell-injection surface; each call is time-boxed.

// Best-effort current branch from .git/HEAD. null when it's not a repo, is detached, or unreadable.
export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const head = await readFile(join(cwd, '.git', 'HEAD'), 'utf-8')
    const m = head.match(/ref:\s*refs\/heads\/(.+)/)
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}

// List local branch names. Empty array when it's not a repo or git fails.
export async function listBranches(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--format=%(refname:short)'], { cwd, timeout: 5_000 })
    return stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

// Switch branch; true on success. The branch comes from listBranches (git's own output).
export async function checkout(cwd: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['checkout', branch], { cwd, timeout: 10_000 })
    return true
  } catch {
    return false
  }
}
