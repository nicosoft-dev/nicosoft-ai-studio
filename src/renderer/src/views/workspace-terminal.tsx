/* ============================================================
   Workspace · Terminal panel — multi-session xterm (design §4).
   Sessions live in the global terminals store (survive conversation/panel switches). This panel renders
   the tab bar + re-parents the active session's host element into its mount; it fits on resize. A new
   session opens at the resolved root cwd, the SAME way the Files panel resolves it (a conversation → its
   primary role's cwd, with a collab messages fallback; an expert greeting → the active expert's cwd) so
   Terminal and Files agree; main falls back to the user's home dir when nothing resolves.
   ============================================================ */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { useT } from '@/stores/locale'
import { useWorkspace } from '@/stores/workspace'
import { useTerminals, hostOf, fitSession } from '@/stores/terminals'
import { resolveConvCwd } from '@/lib/resolve-cwd'
import type { ConversationDto } from '@/lib/api'

export function WorkspaceTerminal({ conv, activeExpert }: { conv: ConversationDto | null; activeExpert: string }): ReactElement {
  const t = useT()
  const cwdByExpert = useWorkspace((s) => s.cwdByExpert)
  const sessions = useTerminals((s) => s.sessions)
  const activeId = useTerminals((s) => s.activeId)
  const setActive = useTerminals((s) => s.setActive)
  const createSession = useTerminals((s) => s.createSession)
  const autoOpen = useTerminals((s) => s.autoOpen)
  const closeSession = useTerminals((s) => s.closeSession)
  const mountRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)
  const cwdRef = useRef<string | null>(null) // latest resolved cwd, used for newly opened sessions

  // Resolve the root cwd like Files does: a conversation → its primary role's cwd (+ collab messages
  // fallback, design §3 P17); an expert greeting → the active expert's cwd. Stash it for new sessions and
  // kick the one-time auto-open once it's known. autoOpen is idempotent (store-level guard), so switching
  // conversations re-resolves the cwd for the NEXT session without spawning extra terminals.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Same root resolution as Files: a conversation → its expert's cwd (+ collab messages fallback);
      // an expert greeting (no conversation) → the active expert's cwd. Falls back to home dir in main.
      let cwd: string | null
      if (conv) {
        cwd = (conv.primaryRoleId ? cwdByExpert[conv.primaryRoleId]?.trim() : '') || null
        if (!cwd) {
          const msgs = await window.api.conversations.messages(conv.id).catch(() => [])
          if (cancelled) return
          cwd = resolveConvCwd(conv, cwdByExpert, msgs)
        }
      } else {
        cwd = cwdByExpert[activeExpert]?.trim() || null
      }
      if (cancelled) return
      cwdRef.current = cwd
      void autoOpen(cwd).catch(() => setError(true))
    })()
    return () => {
      cancelled = true
    }
  }, [conv, activeExpert, cwdByExpert, autoOpen])

  // Re-parent every session host into the mount; show only the active one; fit it.
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    for (const s of sessions) {
      const h = hostOf(s.id)
      if (!h) continue
      if (h.parentElement !== mount) mount.appendChild(h)
      h.style.display = s.id === activeId ? 'block' : 'none'
    }
    if (activeId) fitSession(activeId)
  }, [sessions, activeId])

  // Refit the active terminal whenever the drawer/panel resizes (design §4 P6).
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const ro = new ResizeObserver(() => {
      if (activeId) fitSession(activeId)
    })
    ro.observe(mount)
    return () => ro.disconnect()
  }, [activeId])

  const open = (): void => {
    setError(false)
    void createSession(cwdRef.current).catch(() => setError(true))
  }

  if (error && sessions.length === 0) {
    return (
      <div className="ws-panel">
        <div className="ws-panel-body">
          <div className="ws-empty">{t('terminal.unavailable')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="ws-panel ws-term-panel">
      <div className="term-tabs">
        {sessions.map((s, i) => (
          <div
            key={s.id}
            className={'term-tab' + (s.id === activeId ? ' active' : '') + (s.exited ? ' exited' : '')}
            onClick={() => setActive(s.id)}
          >
            <Icons.terminal size={12} />
            <span className="term-tab-label">{s.title || t('terminal.tab', { n: i + 1 })}</span>
            <button
              className="term-tab-close"
              title={t('common.close')}
              onClick={(e) => {
                e.stopPropagation()
                closeSession(s.id)
              }}
            >
              <Icons.x size={11} />
            </button>
          </div>
        ))}
        <button className="term-new" title={t('terminal.new')} onClick={open}>
          <Icons.plus size={14} />
        </button>
      </div>
      <div className="term-mount" ref={mountRef} />
    </div>
  )
}
