/* ============================================================
   Refcounted git-status poller per cwd (workspace-git-diff §4).
   statusByCwd mirrors main's `git:status` answer for whoever renders it (the composer chip; the Diff
   panel pulls `git:diff` itself). Subscribers acquire a ref per cwd — chip tier ticks every 5 s, panel
   tier every 15 s — and BOTH land on main's TTL memos (info/dirty 5 s, stats 30 s), so real git runs at
   most once per TTL no matter how often we ask. Extra refreshes: on acquire, on window focus, on the
   conv:git push (a git-mutating Bash result just invalidated main's memos) and on turn settle
   (chat.ts pings `nsai:turn-settled`). Blur pauses ticks; the set is state-diffed so polling never
   flickers the chip (§8.2).
   ============================================================ */
import { create } from 'zustand'
import type { GitWorkStatus } from '@/lib/api'

interface GitStatusState {
  statusByCwd: Record<string, GitWorkStatus>
}
export const useGitStatus = create<GitStatusState>(() => ({ statusByCwd: {} }))

// Derived chip/button state (§2 table): dirty → Commit changes; clean but unpushed (ahead, or a branch
// with no upstream while a remote exists) → Push / PR; synced or not a repo → nothing. A remoteless local
// repo never nags — there is nowhere to push.
export function gitAction(s: GitWorkStatus | undefined): 'commit' | 'push' | null {
  if (!s?.isRepo) return null
  if (s.dirty) return 'commit'
  if (s.ahead > 0 || (!s.hasUpstream && s.hasRemote && !!s.branch)) return 'push'
  return null
}

const CHIP_INTERVAL_MS = 5_000
const PANEL_INTERVAL_MS = 15_000

interface Watcher {
  chip: number
  panel: number
  timer: ReturnType<typeof setInterval> | null
}
const watchers = new Map<string, Watcher>()

async function refresh(cwd: string): Promise<void> {
  try {
    const s = await window.api.git.status(cwd)
    if (!s) return
    useGitStatus.setState((st) => {
      const prev = st.statusByCwd[cwd]
      if (prev && JSON.stringify(prev) === JSON.stringify(s)) return st // state-diffed — no flicker
      return { statusByCwd: { ...st.statusByCwd, [cwd]: s } }
    })
  } catch {
    // best-effort: a git hiccup must never break the composer
  }
}

function arm(cwd: string): void {
  const w = watchers.get(cwd)
  if (!w) return
  if (w.timer) clearInterval(w.timer)
  const period = w.chip > 0 ? CHIP_INTERVAL_MS : PANEL_INTERVAL_MS
  w.timer = setInterval(() => {
    if (document.hasFocus()) void refresh(cwd) // window-blur pauses (§6); focus below catches back up
  }, period)
}

// Hold a polling ref on a cwd; returns the release. Chip and panel tiers coexist — the fastest active
// tier wins the interval; releasing the last ref stops the timer entirely.
export function acquireGitStatus(cwd: string, tier: 'chip' | 'panel'): () => void {
  let w = watchers.get(cwd)
  if (!w) {
    w = { chip: 0, panel: 0, timer: null }
    watchers.set(cwd, w)
  }
  w[tier]++
  arm(cwd)
  void refresh(cwd)
  let released = false
  return () => {
    if (released) return
    released = true
    const cur = watchers.get(cwd)
    if (!cur) return
    cur[tier] = Math.max(0, cur[tier] - 1)
    if (cur.chip + cur.panel === 0) {
      if (cur.timer) clearInterval(cur.timer)
      watchers.delete(cwd)
    } else {
      arm(cwd)
    }
  }
}

// App-lifetime listeners (module load, like conv-services): they must outlive every chip/panel mount.
// conv:git carries main's realpath'd cwd, which may not string-match a symlinked watcher key (/tmp vs
// /private/tmp) — miss → refresh every watched cwd; the true one hits its invalidated memo, the rest land
// on warm memos for free.
window.api.onConvGit((d) => {
  if (watchers.has(d.cwd)) void refresh(d.cwd)
  else for (const cwd of watchers.keys()) void refresh(cwd)
})
window.addEventListener('focus', () => {
  for (const cwd of watchers.keys()) void refresh(cwd)
})
window.addEventListener('nsai:turn-settled', () => {
  for (const cwd of watchers.keys()) void refresh(cwd)
})
