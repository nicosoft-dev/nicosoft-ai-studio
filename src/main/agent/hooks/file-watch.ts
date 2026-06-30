// hooks/file-watch.ts — the watchPaths → FileChanged loop. A SessionStart (or FileChanged) hook returns
// hookSpecificOutput.watchPaths; this manager arms a watcher on each path, and on a change fires the
// FileChanged hooks (file_event = change | add_or_unlink), whose OWN watchPaths re-arm the set — a closed loop.
// Per-conversation, torn down on conv-delete / app-exit. Uses Node's built-in fs.watch (no extra dependency);
// events are debounced (fs.watch fires several per change) and an unchanged path set is never rebuilt.

import { watch, type FSWatcher } from 'node:fs'
import { confineReal } from '../confine'
import { runHooks } from './engine'
import type { HookExecContext } from './types'
import type { HookPayload } from './events'

interface ConvWatch {
  cwd: string
  sessionDir: string
  roleId?: string
  paths: string[]
  sourcePaths: string[]
  watchers: FSWatcher[]
  debounce: Map<string, ReturnType<typeof setTimeout>>
  ac: AbortController
}

const DEBOUNCE_MS = 100

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

class FileWatchManager {
  private convs = new Map<string, ConvWatch>()

  // Arm (or re-arm) the watcher set for a conv. Every path is CONFINED under the run's cwd first (the same gate
  // the Monitor file probe uses, src/main/agent/confine.ts) so a hook can NOT arm a watcher on '/', $HOME, or
  // anything outside the project — a path that escapes (or can't resolve) is dropped. Unchanged set → no rebuild;
  // empty set → dispose. Async only for the confinement; the map mutation stays in the synchronous armConfined.
  async arm(convId: string, paths: string[], base: { cwd: string; sessionDir: string; roleId?: string }): Promise<void> {
    const confined: string[] = []
    const sourcePaths: string[] = []
    for (const p of paths) {
      try {
        confined.push(await confineReal(base.cwd, p))
        sourcePaths.push(p)
      } catch {
        /* escapes the project dir or is inaccessible — never watch outside cwd */
      }
    }
    this.armConfined(convId, confined, sourcePaths, base)
  }

  async rearmForCwdChange(convId: string, watchPaths: string[], base: { cwd: string; sessionDir: string; roleId?: string }): Promise<void> {
    const existing = this.convs.get(convId)
    const nextPaths = watchPaths.length > 0 ? watchPaths : existing?.sourcePaths ?? []
    if (nextPaths.length === 0) return
    await this.arm(convId, nextPaths, base)
  }

  // The synchronous, atomic arm (dispose + create watchers + register) over an ALREADY-confined path set. Split
  // out so the only async work (confinement) completes before any map mutation, keeping the mutation race-free.
  private armConfined(convId: string, paths: string[], sourcePaths: string[], base: { cwd: string; sessionDir: string; roleId?: string }): void {
    const sorted = [...new Set(paths)].sort()
    const existing = this.convs.get(convId)
    if (existing && sameSet(existing.paths, sorted) && existing.cwd === base.cwd && existing.sessionDir === base.sessionDir && existing.roleId === base.roleId) {
      existing.sourcePaths = sourcePaths
      return
    }
    this.disposeForConv(convId)
    if (sorted.length === 0) return
    const cw: ConvWatch = { cwd: base.cwd, sessionDir: base.sessionDir, roleId: base.roleId, paths: [], sourcePaths, watchers: [], debounce: new Map(), ac: new AbortController() }
    for (const p of sorted) {
      try {
        const w = watch(p, (eventType, filename) => this.onFsEvent(convId, p, eventType, filename))
        w.on('error', () => {}) // a watched path removed / perms → swallow rather than crash the main process
        cw.paths.push(p)
        cw.watchers.push(w)
      } catch {
        /* path doesn't exist yet — keep sourcePaths and retry on the next arm/re-arm */
      }
    }
    this.convs.set(convId, cw)
  }

  private onFsEvent(convId: string, path: string, eventType: string, filename: string | Buffer | null): void {
    const cw = this.convs.get(convId)
    if (!cw) return
    const name = typeof filename === 'string' ? filename : ''
    const key = `${path}:${name}`
    const prev = cw.debounce.get(key)
    if (prev) clearTimeout(prev)
    cw.debounce.set(
      key,
      setTimeout(() => {
        cw.debounce.delete(key)
        void this.fireFileChanged(convId, path, eventType, name)
      }, DEBOUNCE_MS),
    )
  }

  private async fireFileChanged(convId: string, path: string, eventType: string, filename: string): Promise<void> {
    const cw = this.convs.get(convId)
    if (!cw) return
    const ctx: HookExecContext = { convId, cwd: cw.cwd, sessionDir: cw.sessionDir, permissionMode: 'default', signal: cw.ac.signal, roleId: cw.roleId }
    const payload: HookPayload = {
      hook_event_name: 'FileChanged',
      session_id: convId,
      cwd: cw.cwd,
      permission_mode: 'default',
      path,
      // fs.watch reports 'rename' (create/delete/move) or 'change' (content) — normalize to the loop's vocabulary.
      file_event: eventType === 'rename' ? 'add_or_unlink' : 'change',
      filename: filename || undefined,
    }
    const merged = await runHooks('FileChanged', payload, ctx)
    // A FileChanged hook can return NEW watchPaths → re-arm the set (the loop). Empty → keep the current set.
    if (merged.watchPaths.length > 0) await this.arm(convId, merged.watchPaths, { cwd: cw.cwd, sessionDir: cw.sessionDir, roleId: cw.roleId })
  }

  disposeForConv(convId: string): void {
    const cw = this.convs.get(convId)
    if (!cw) return
    cw.ac.abort()
    for (const w of cw.watchers) {
      try {
        w.close()
      } catch {
        /* already closed */
      }
    }
    for (const t of cw.debounce.values()) clearTimeout(t)
    this.convs.delete(convId)
  }

  disposeAll(): void {
    for (const id of [...this.convs.keys()]) this.disposeForConv(id)
  }
}

export const fileWatchManager = new FileWatchManager()
