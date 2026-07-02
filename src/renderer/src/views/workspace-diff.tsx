/* ============================================================
   Workspace · Diff panel — the conversation repo's working diff (workspace-git-diff §5.1).
   Read-only viewer over `git:diff` (CC nEe pipeline): per-file collapsible unified patches for the
   merge-base → working-tree span, so uncommitted AND unpushed changes show together (committed-but-
   unpushed needs no special state — that IS the merge-base diff; a header lists the unpushed subjects
   for orientation). The file list is always complete; only patch BODIES degrade (binary / oversize /
   5 MB over-cap → counts + a "content not shown" note). Root cwd resolves exactly like the Files panel
   (resolveConvCwd); refresh = on open, every 15 s while visible, on conv:git, on turn settle — all
   landing on main's 30 s memo, usually pre-warmed by the stats→diff prefetch.
   ============================================================ */
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { useT } from '@/stores/locale'
import { useWorkspace } from '@/stores/workspace'
import { resolveConvCwd } from '@/lib/resolve-cwd'
import type { ConversationDto, GitFileDiff, GitWorkDiff } from '@/lib/api'

const PANEL_REFRESH_MS = 15_000
const EXPAND_ALL_MAX = 8 // ≤ N changed files → sections start expanded
const SUBJECTS_SHOWN = 10

export function WorkspaceDiff({ conv, activeExpert }: { conv: ConversationDto | null; activeExpert: string }): ReactElement {
  const t = useT()
  const cwdByExpert = useWorkspace((s) => s.cwdByExpert)
  const [rootCwd, setRootCwd] = useState<string | null>(null)
  const [resolving, setResolving] = useState(true)
  const [diff, setDiff] = useState<GitWorkDiff | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Resolve the root cwd — the SAME resolution as the Files panel (primary role's cwd, coordinator/collab
  // fallback via messages, greeting → active expert's cwd).
  useEffect(() => {
    let cancelled = false
    setRootCwd(null)
    setDiff(null)
    setLoaded(false)
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

  const load = useCallback(async (): Promise<void> => {
    if (!rootCwd) return
    const d = await window.api.git.diff(rootCwd).catch(() => null)
    setDiff(d)
    setLoaded(true)
  }, [rootCwd])

  useEffect(() => {
    if (!rootCwd) return
    void load()
    const timer = setInterval(() => {
      if (document.hasFocus()) void load()
    }, PANEL_REFRESH_MS)
    const offGit = window.api.onConvGit(() => void load()) // push-invalidated → re-ask now
    const onSettle = (): void => void load()
    window.addEventListener('nsai:turn-settled', onSettle)
    return () => {
      clearInterval(timer)
      offGit()
      window.removeEventListener('nsai:turn-settled', onSettle)
    }
  }, [rootCwd, load])

  if (resolving || (rootCwd && !loaded)) return <div className="gd-empty">{t('files.loading')}</div>
  if (!rootCwd) return <div className="gd-empty">{t('files.noCwd')}</div>
  if (!diff) return <div className="gd-empty">{t('diff.noRepo')}</div>

  const additions = diff.files.reduce((s, f) => s + f.additions, 0)
  const deletions = diff.files.reduce((s, f) => s + f.deletions, 0)
  const expandDefault = diff.files.length <= EXPAND_ALL_MAX

  return (
    <div className="ws-diff">
      <div className="gd-header">
        {diff.branch ? (
          <span className="gd-branch" title={diff.branch}>
            <Icons.gitBranch size={12} />
            <span className="gd-branch-name">{diff.branch}</span>
          </span>
        ) : null}
        {diff.files.length > 0 ? (
          <span className="git-chip-counts">
            <span className="git-add">+{additions}</span>
            <span className="git-del">−{deletions}</span>
          </span>
        ) : null}
        {diff.files.length > 0 ? <span className="gd-filecount">{t('diff.filesChanged', { n: String(diff.files.length) })}</span> : null}
        <button className="icon-btn" title={t('files.refresh')} onClick={() => void load()} style={{ marginLeft: 'auto' }}>
          <Icons.refresh size={14} />
        </button>
      </div>
      {diff.ahead > 0 && diff.unpushedSubjects.length > 0 ? (
        <div className="gd-unpushed">
          <div className="gd-unpushed-title">{t('diff.unpushed', { n: String(diff.ahead) })}</div>
          {diff.unpushedSubjects.slice(0, SUBJECTS_SHOWN).map((s, i) => (
            <div key={i} className="gd-unpushed-subject">
              {s}
            </div>
          ))}
          {diff.unpushedSubjects.length > SUBJECTS_SHOWN ? <div className="gd-unpushed-subject">…</div> : null}
        </div>
      ) : null}
      {diff.patchesOmitted ? <div className="gd-notice">{t('diff.patchesOmitted')}</div> : null}
      {diff.files.length === 0 ? (
        <div className="gd-empty">{t('diff.clean')}</div>
      ) : (
        <div className="gd-files">
          {diff.files.map((f) => (
            <FileSection key={f.path} f={f} defaultOpen={expandDefault} />
          ))}
        </div>
      )}
    </div>
  )
}

const STATUS_LETTER: Record<GitFileDiff['status'], string> = { added: 'A', removed: 'D', renamed: 'R', modified: 'M' }

function FileSection({ f, defaultOpen }: { f: GitFileDiff; defaultOpen: boolean }): ReactElement {
  const t = useT()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="gd-file">
      <button className="gd-file-head" onClick={() => setOpen((o) => !o)}>
        <Icons.chevronRight size={12} className={'gd-caret' + (open ? ' open' : '')} />
        <span className={'gd-status ' + f.status}>{STATUS_LETTER[f.status]}</span>
        <span className="gd-path" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
          {f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
        </span>
        <span className="git-chip-counts">
          {f.additions > 0 ? <span className="git-add">+{f.additions}</span> : null}
          {f.deletions > 0 ? <span className="git-del">−{f.deletions}</span> : null}
        </span>
      </button>
      {open ? (
        f.patch ? (
          <pre className="gd-patch">
            {f.patch.split('\n').map((l, i) => (
              <div key={i} className={'gd-line' + patchLineClass(l)}>
                {l || ' '}
              </div>
            ))}
          </pre>
        ) : (
          <div className="gd-stub">{t('diff.contentNotShown')}</div>
        )
      ) : null}
    </div>
  )
}

function patchLineClass(l: string): string {
  if (l.startsWith('@@')) return ' hunk'
  if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('new file') || l.startsWith('deleted file') || l.startsWith('rename ') || l.startsWith('similarity ') || l.startsWith('old mode') || l.startsWith('new mode') || l.startsWith('Binary files')) return ' meta'
  if (l.startsWith('+')) return ' add'
  if (l.startsWith('-')) return ' del'
  return ''
}
