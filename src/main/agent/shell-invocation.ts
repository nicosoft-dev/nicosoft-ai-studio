// Windows shell adaptation, aligned with Claude Code (utils/windowsPaths.ts + Shell.ts) and the Claude
// Desktop binary: on Windows every model-authored shell command runs through git-bash's bash.exe —
// NEVER cmd.exe (it cannot parse bash syntax, so `shell: true` guarantees failure) and NEVER
// System32\bash.exe (that is WSL: the command would silently run inside a Linux distro, worse than
// failing). All spawns carry windowsHide so no console window flashes over the GUI app. A missing
// git-bash is a guided per-call error — Studio is a GUI app, so unlike the CC CLI it must not
// process.exit; the guidance text mirrors the Desktop app's preflight message.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import * as pathWin32 from 'node:path/win32'

// Studio's own override first; CLAUDE_CODE_GIT_BASH_PATH honored so users who already configured
// Claude Code on the same machine need zero setup.
const GIT_BASH_ENV_VARS = ['NSAI_GIT_BASH_PATH', 'CLAUDE_CODE_GIT_BASH_PATH'] as const

const DEFAULT_GIT_BASH_LOCATIONS = [
  // 64-bit before 32-bit, same order CC probes git.exe
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
]

export const GIT_BASH_GUIDANCE =
  'Studio on Windows requires Git Bash to run shell commands. Install Git for Windows from ' +
  'https://git-scm.com/download/win (it includes Git Bash), then try again. If Git is installed in a ' +
  'non-standard location, set the NSAI_GIT_BASH_PATH environment variable to the full path of bash.exe ' +
  '(e.g. C:\\Program Files\\Git\\bin\\bash.exe) and restart Studio.'

export class GitBashMissingError extends Error {
  constructor() {
    super(GIT_BASH_GUIDANCE)
    this.name = 'GitBashMissingError'
  }
}

// System32\bash.exe (and the Sysnative alias 32-bit processes see) launches WSL, not a Windows bash.
export function isWslBashPath(p: string): boolean {
  return /[\\/](system32|sysnative)[\\/]bash\.exe$/i.test(p)
}

let cachedGitBash: string | null | undefined

/** Locate git-bash's bash.exe. Memoized for the process lifetime (CC memoizes the same way). */
export function findGitBashPath(): string | null {
  if (cachedGitBash === undefined) cachedGitBash = locateGitBash()
  return cachedGitBash
}

export function resetGitBashCacheForTests(): void {
  cachedGitBash = undefined
}

function locateGitBash(): string | null {
  for (const name of GIT_BASH_ENV_VARS) {
    const p = process.env[name]
    if (p && !isWslBashPath(p) && existsSync(p)) return p
  }
  for (const p of DEFAULT_GIT_BASH_LOCATIONS) if (existsSync(p)) return p
  // Derive from git.exe (…\Git\cmd\git.exe → …\Git\bin\bash.exe). where.exe may list a git.exe planted
  // inside the working directory — skip those, same poisoning filter CC applies.
  try {
    const out = execFileSync('where.exe', ['git'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 3_000,
      windowsHide: true,
    })
    const cwd = pathWin32.resolve(process.cwd()).toLowerCase()
    for (const line of out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const norm = pathWin32.resolve(line).toLowerCase()
      if (norm === cwd || norm.startsWith(cwd + pathWin32.sep) || pathWin32.dirname(norm) === cwd) continue
      const bash = pathWin32.join(pathWin32.dirname(line), '..', 'bin', 'bash.exe')
      if (!isWslBashPath(bash) && existsSync(bash)) return bash
    }
  } catch {
    /* where.exe unavailable or nothing found */
  }
  return null
}

export interface ShellSpawnPlan {
  file: string
  args: string[]
  options: { shell?: true; detached: boolean; windowsHide: true }
}

/**
 * Build spawn() arguments for a model-authored shell command.
 *  - POSIX keeps today's verified shape: `shell: true` (/bin/sh) — or an explicit `bash -lc` when
 *    opts.login is set — with detached: true so the child leads its own process group for killTree.
 *  - win32 runs git-bash explicitly: `bash.exe -c <command>`. detached is false — on Windows detached
 *    means "give the child its own console window" and process groups don't help kill anyway
 *    (killTree uses taskkill /T). Throws GitBashMissingError when git-bash cannot be found.
 */
export function planShellSpawn(command: string, opts: { login?: boolean } = {}): ShellSpawnPlan {
  const flag = opts.login ? '-lc' : '-c'
  if (process.platform === 'win32') {
    const bash = findGitBashPath()
    if (!bash) throw new GitBashMissingError()
    return { file: bash, args: [flag, command], options: { detached: false, windowsHide: true } }
  }
  if (opts.login) return { file: 'bash', args: [flag, command], options: { detached: true, windowsHide: true } }
  return { file: command, args: [], options: { shell: true, detached: true, windowsHide: true } }
}

/**
 * Kill a whole process tree. POSIX: signal the group (-pid; the child was spawned detached as its own
 * group leader), falling back to the single pid. Windows: taskkill /T walks the tree; there is no
 * graceful tier there, so both SIGTERM and SIGKILL requests hard-kill with /F (the Desktop binary does
 * the same). taskkill's own spawn failures surface as an async 'error' event — the no-op listener keeps
 * an unspawnable taskkill from crashing the main process.
 */
export function killTree(pid: number, sig: NodeJS.Signals): void {
  if (process.platform === 'win32') {
    try {
      const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      tk.on('error', () => {})
    } catch {
      /* already gone */
    }
    return
  }
  try {
    process.kill(-pid, sig)
  } catch {
    try {
      process.kill(pid, sig)
    } catch {
      /* already gone */
    }
  }
}

/** `C:\Users\foo` → `/c/Users/foo`, `\\server\share` → `//server/share`. Pure, platform-independent. */
export function windowsPathToPosixPath(windowsPath: string): string {
  if (windowsPath.startsWith('\\\\')) return windowsPath.replace(/\\/g, '/')
  const m = windowsPath.match(/^([A-Za-z]):[/\\]/)
  if (m) return '/' + m[1].toLowerCase() + windowsPath.slice(2).replace(/\\/g, '/')
  return windowsPath.replace(/\\/g, '/')
}

/** `/c/Users/foo` or `/cygdrive/c/Users/foo` → `C:\Users\foo`. Pure, platform-independent. */
export function posixPathToWindowsPath(posixPath: string): string {
  if (posixPath.startsWith('//')) return posixPath.replace(/\//g, '\\')
  const cyg = posixPath.match(/^\/cygdrive\/([A-Za-z])(\/|$)/)
  if (cyg) {
    const rest = posixPath.slice('/cygdrive/'.length + 1)
    return cyg[1].toUpperCase() + ':' + (rest || '\\').replace(/\//g, '\\')
  }
  const drive = posixPath.match(/^\/([A-Za-z])(\/|$)/)
  if (drive) {
    const rest = posixPath.slice(2)
    return drive[1].toUpperCase() + ':' + (rest || '\\').replace(/\//g, '\\')
  }
  return posixPath.replace(/\//g, '\\')
}

/** Path equality for cwd-change detection: Windows filesystems are case-insensitive. */
export function shellPathsEqual(a: string, b: string): boolean {
  if (process.platform === 'win32') return a.toLowerCase() === b.toLowerCase()
  return a === b
}
