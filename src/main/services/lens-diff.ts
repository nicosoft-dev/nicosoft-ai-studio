import { execFile } from 'node:child_process'

// Git helpers for the multi-lens Gate B content trigger (gate-b-multilens §3.2 / M2): capture the
// implementer's REAL changed paths so dimension selection is content-driven, not size/prompt-driven.
// Mirrors git-snapshot.ts's runner — resolves '' / [] on any error, never throws (the trigger must
// degrade to floor-only, never break a gated step).

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 10_000 }, (err, stdout) => resolve(err ? '' : String(stdout).trim()))
  })
}

// The commit the implementer starts from — record this BEFORE the implementer runs. '' if not a git repo
// (then the content trigger simply finds no diff and the step stays floor-only).
export async function gitHead(cwd: string | undefined): Promise<string> {
  if (!cwd) return ''
  if ((await git(cwd, ['rev-parse', '--is-inside-work-tree'])) !== 'true') return ''
  return git(cwd, ['rev-parse', 'HEAD'])
}

// Paths the implementer changed since `base`, INCLUDING new untracked files. Plain `git diff` misses
// untracked files — exactly the "brand-new auth/migration file" case the content trigger must catch
// (audit finding on git-snapshot's tracked-only stash). Empty when not a repo or nothing changed.
export async function changedPathsSince(cwd: string | undefined, base: string): Promise<string[]> {
  if (!cwd || !base) return []
  const tracked = (await git(cwd, ['diff', '--name-only', base])).split('\n').filter(Boolean)
  const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean)
  return [...new Set([...tracked, ...untracked])]
}
