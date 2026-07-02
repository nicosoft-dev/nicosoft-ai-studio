// git-broadcast.ts — conv-level push that a conversation's git state just changed (workspace-git-diff §4.2).
//
// Fired from the tool:post seam in drainAgentRun when a git-MUTATING Bash tool result lands (commit, push,
// checkout, …): main has already invalidated that cwd's git memos, and this tells the renderer chip/panel
// to refresh NOW instead of waiting out their poll interval — CC's event-push invalidation, ported onto the
// same all-windows convId-keyed broadcast conv:services / conv:todos / conv:lens use. No fs watchers, no
// blind polling: plain file edits are covered by the TTLs; the agent's own git commands are covered here.
import { BrowserWindow } from 'electron'
import type { ConvGit } from './contracts'

export function broadcastConvGit(convId: string, cwd: string): void {
  const ev: ConvGit = { convId, cwd }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('conv:git', ev)
}
