/* ============================================================
   Workspace · Files panel — whole-project tree (view-only) + by-type viewer.
   Root = the active expert's working directory (cwdByExpert[role]): for a conversation, its primary
   role's cwd (with a collab/coordinator messages fallback, design §3 P17); on an expert's greeting (no
   conversation yet) the active expert's cwd. cwd is set per expert by the composer path bar, so the tree
   shows the moment a folder is picked — before any message. Every fs op goes through confined fs:* IPC
   (the resolved absolute root + a relative path; main confineReal keeps relPath under the root).
   ============================================================ */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '@/components/icons'
import { useT } from '@/stores/locale'
import { useWorkspace } from '@/stores/workspace'
import { toast } from '@/stores/toast'
import { resolveConvCwd } from '@/lib/resolve-cwd'
import { fileColor } from '@/lib/file-icons'
import { FileViewer } from '@/views/workspace-file-viewer'
import type { ConversationDto, FsEntry } from '@/lib/api'

interface MenuState {
  x: number
  y: number
  relPath: string
  name: string
  type: 'file' | 'dir'
}

export function WorkspaceFiles({ conv, activeExpert }: { conv: ConversationDto | null; activeExpert: string }): ReactElement {
  const t = useT()
  const cwdByExpert = useWorkspace((s) => s.cwdByExpert)
  const setExpandedForCwd = useWorkspace((s) => s.setExpandedForCwd)
  const [rootCwd, setRootCwd] = useState<string | null>(null)
  const [resolving, setResolving] = useState(true)
  const [children, setChildren] = useState<Record<string, FsEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [truncated, setTruncated] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [viewer, setViewer] = useState<{ relPath: string; name: string } | null>(null)

  const loadDir = useCallback(
    async (relPath: string): Promise<void> => {
      if (!rootCwd) return
      const res = await window.api.fs.listDir(rootCwd, relPath)
      setChildren((c) => ({ ...c, [relPath]: res.entries }))
      setTruncated((tr) => {
        const next = new Set(tr)
        if (res.truncated) next.add(relPath)
        else next.delete(relPath)
        return next
      })
    },
    [rootCwd]
  )

  // Resolve the root cwd. A conversation → its primary role's cwd, else (coordinator/collab, empty
  // primary) the first participating role's cwd via the messages. No conversation (an expert greeting) →
  // the active expert's cwd. Re-runs when the conversation, active expert, or any cwd changes (path bar).
  useEffect(() => {
    let cancelled = false
    setRootCwd(null)
    setChildren({})
    setExpanded(new Set())
    setTruncated(new Set())
    setViewer(null)
    setFilter('')
    setResolving(true)
    void (async () => {
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
      setRootCwd(cwd)
      setResolving(false)
    })()
    return () => {
      cancelled = true
    }
  }, [conv, activeExpert, cwdByExpert])

  // Load the tree root once the cwd resolves, and restore the previously-expanded folders for this root
  // (persisted per cwd) so the tree reopens where you left it. getState() reads the saved set without
  // making it a dep — restore happens once per root change.
  useEffect(() => {
    if (!rootCwd) return
    const saved = useWorkspace.getState().expandedByCwd[rootCwd] ?? []
    setExpanded(new Set(saved))
    void loadDir('').catch(() => {})
    for (const d of saved) void loadDir(d).catch(() => {})
  }, [rootCwd, loadDir])

  // Re-load the currently-shown dirs in place (no clear → no flicker). Kept in a ref so the watch effect
  // (keyed on rootCwd only) always runs the latest closure — current expanded set — without re-arming the
  // watcher on every expand/collapse.
  const refreshRef = useRef<() => void>(() => {})
  refreshRef.current = (): void => {
    for (const d of ['', ...expanded]) void loadDir(d).catch(() => {})
  }

  // Live refresh: watch the open root in main; reload when its contents change (file added by an agent /
  // terminal / external editor — so an empty folder fills in without a manual refresh).
  useEffect(() => {
    if (!rootCwd) return
    void window.api.fs.watch(rootCwd).catch(() => {})
    const off = window.api.onFsChanged((d) => {
      if (d.cwd === rootCwd) refreshRef.current()
    })
    return () => {
      off()
      void window.api.fs.unwatch().catch(() => {})
    }
  }, [rootCwd])

  const toggleDir = (relPath: string): void => {
    setExpanded((ex) => {
      const next = new Set(ex)
      if (next.has(relPath)) next.delete(relPath)
      else {
        next.add(relPath)
        if (!children[relPath]) void loadDir(relPath).catch(() => {})
      }
      if (rootCwd) setExpandedForCwd(rootCwd, [...next]) // persist so the open state survives reopen
      return next
    })
  }

  const reload = (): void => {
    if (!rootCwd) return
    const dirs = ['', ...expanded]
    setChildren({})
    for (const d of dirs) void loadDir(d).catch(() => {})
  }

  const absPath = (relPath: string): string => (rootCwd ? rootCwd.replace(/\/+$/, '') + '/' + relPath : relPath)

  const onMenuAction = (action: 'reveal' | 'copy' | 'insert' | 'open', m: MenuState): void => {
    setMenu(null)
    if (!rootCwd) return
    if (action === 'reveal') void window.api.fs.reveal(rootCwd, m.relPath).catch(() => toast.error(t('files.revealFailed')))
    else if (action === 'copy') void navigator.clipboard.writeText(absPath(m.relPath)).then(() => toast.success(t('files.pathCopied'))).catch(() => {})
    else if (action === 'insert') window.dispatchEvent(new CustomEvent('nsai:insert-to-composer', { detail: { text: m.relPath } }))
    else if (action === 'open') void window.api.fs.openDefault(rootCwd, m.relPath).catch(() => toast.error(t('files.openFailed')))
  }

  const q = filter.trim().toLowerCase()
  const matches = (name: string): boolean => !q || name.toLowerCase().includes(q)

  // Recursively render a loaded directory's entries. A dir whose name doesn't match the filter is still
  // shown while expanded so matching descendants stay reachable.
  const renderEntries = (parentRel: string, depth: number): ReactElement[] => {
    const entries = children[parentRel] ?? []
    return entries.flatMap((e) => {
      const rel = parentRel ? `${parentRel}/${e.name}` : e.name
      const isOpenDir = e.type === 'dir' && expanded.has(rel)
      if (!matches(e.name) && !isOpenDir) return []
      const row = (
        <div
          key={rel}
          className="ft-row"
          style={{ paddingLeft: 8 + depth * 14 }}
          title={e.name}
          onClick={() => (e.type === 'dir' ? toggleDir(rel) : setViewer({ relPath: rel, name: e.name }))}
          onContextMenu={(ev) => {
            ev.preventDefault()
            setMenu({ x: ev.clientX, y: ev.clientY, relPath: rel, name: e.name, type: e.type })
          }}
        >
          {e.type === 'dir' ? (
            <span className={'ft-chev' + (isOpenDir ? ' open' : '')}>
              <Icons.chevronRight size={12} />
            </span>
          ) : (
            <span className="ft-chev-spacer" />
          )}
          <span className="ft-ic" style={e.type === 'file' ? { color: fileColor(e.name) } : undefined}>
            {e.type === 'dir' ? <Icons.folder size={15} /> : <Icons.file size={15} />}
          </span>
          <span className="ft-name">{e.name}</span>
        </div>
      )
      if (!isOpenDir) return [row]
      const kids = renderEntries(rel, depth + 1)
      if (truncated.has(rel)) {
        kids.push(
          <div key={rel + ' more'} className="ft-more" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
            {t('files.more')}
          </div>
        )
      }
      return [row, ...kids]
    })
  }

  return (
    <div className="ws-panel">
      {rootCwd && (
        <div className="ft-toolbar">
          <span className="ft-search">
            <Icons.search size={13} />
            <input
              className="ft-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('files.filterPlaceholder')}
              spellCheck={false}
            />
          </span>
          <button className="icon-btn" title={t('files.refresh')} onClick={reload}>
            <Icons.refresh size={15} />
          </button>
        </div>
      )}
      <div className="ft-tree">
        {resolving ? (
          <div className="ws-empty">{t('files.loading')}</div>
        ) : !rootCwd ? (
          <div className="ws-empty">{t('files.noCwd')}</div>
        ) : (
          <>
            {renderEntries('', 0)}
            {truncated.has('') && <div className="ft-more" style={{ paddingLeft: 8 }}>{t('files.more')}</div>}
          </>
        )}
      </div>

      {menu &&
        createPortal(
          <>
            <div className="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
            <div className="fctx-menu" style={{ left: menu.x, top: menu.y }}>
              <div className="rm-item" onClick={() => onMenuAction('reveal', menu)}><Icons.folder size={14} /> {t('files.reveal')}</div>
              <div className="rm-item" onClick={() => onMenuAction('copy', menu)}><Icons.copy size={14} /> {t('files.copyPath')}</div>
              <div className="rm-item" onClick={() => onMenuAction('insert', menu)}><Icons.cornerDownLeft size={14} /> {t('files.insertPath')}</div>
              {menu.type === 'file' && (
                <div className="rm-item" onClick={() => onMenuAction('open', menu)}><Icons.externalLink size={14} /> {t('files.openDefault')}</div>
              )}
            </div>
          </>,
          document.body
        )}

      {viewer && rootCwd && (
        <FileViewer cwd={rootCwd} relPath={viewer.relPath} name={viewer.name} onClose={() => setViewer(null)} />
      )}
    </div>
  )
}
