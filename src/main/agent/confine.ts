// Working-directory confinement: resolve a tool's path argument to an absolute path and reject
// anything that escapes the agent's cwd — lexically AND through symlinks. Every file/dir tool must
// run its path through confineReal before any I/O. See docs/nicosoft-studio/12-hex-coding-agent.md §3.

import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

class ConfinementError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfinementError'
  }
}

// Lexical-only: resolve `p` against `cwd` and ensure it stays inside `cwd`. Cheap but blind to
// symlinks — use confineReal for anything that actually gets opened.
function confinePath(cwd: string, p: string): string {
  const abs = isAbsolute(p) ? resolve(p) : resolve(cwd, p)
  const rel = relative(cwd, abs)
  if (rel === '') return abs // the cwd itself
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ConfinementError(`Path escapes the project directory: ${p}`)
  }
  return abs
}

// realpath the nearest EXISTING ancestor of `abs`, re-appending the non-existent tail. So a symlinked
// parent dir of a not-yet-created file still gets resolved — closing the create-path symlink escape
// that a plain realpath(abs) misses (realpath throws on a missing target).
async function resolveNearest(abs: string): Promise<string> {
  const tail: string[] = []
  let dir = abs
  for (;;) {
    try {
      const real = await realpath(dir)
      return tail.length > 0 ? join(real, ...tail.reverse()) : real
    } catch {
      const parent = dirname(dir)
      if (parent === dir) return abs // hit fs root with nothing existing (degenerate)
      tail.push(basename(dir))
      dir = parent
    }
  }
}

// Lexical confinement + realpath of the nearest existing ancestor (resolves symlinks on both the
// existing-file read path and the create/write path). Use for any path that gets read/opened/written.
export async function confineReal(cwd: string, p: string): Promise<string> {
  const abs = confinePath(cwd, p) // lexical gate first
  let cwdReal: string
  try {
    cwdReal = await realpath(cwd)
  } catch {
    throw new ConfinementError('Project directory is no longer accessible')
  }
  const real = await resolveNearest(abs)
  const rel = relative(cwdReal, real)
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new ConfinementError(`Path resolves outside the project via symlink: ${p}`)
  }
  return real
}
