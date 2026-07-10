/* ============================================================
   NicoSoft AI Studio — workflow draft card (workflow-assisted-authoring §6)
   An expert drafted a workflow in chat (workflow_draft tool): this card is the CONFIRMATION surface —
   name/description/params and a read-only flow diagram, all derived on mount via workflows.lint(script)
   from the payload's script (never stored redundantly → diagram and script cannot drift). Nothing exists
   in the workflows table until [Create] here; revisions land as new cards and gray this one out.
   Four states, derived from payload + lint alone (no local persistence, so reload restores them):
     superseded — replaced by a newer draft (grayed; wins over created so the CURRENT card is unambiguous)
     created    — the user confirmed; ✓ + [Open]
     broken     — the script no longer lints (a step role disabled since) — [Create] disabled
     draft      — full card + [Create|Update <name>] + [Open in editor] (prefill only, no persistence)
   ============================================================ */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { WorkflowFlow } from '@/components/workflow-flow'
import { useAllExperts, useExpertMeta } from '@/lib/all-experts'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toast'
import { useT } from '@/stores/locale'

type LintDto = Awaited<ReturnType<typeof window.api.workflows.lint>>

// Local mirror of main's WorkflowDraftPayload (contracts §3.1) — validated, not trusted.
interface DraftPayload {
  v: 1
  draftId: string
  script: string
  supersedes?: string
  superseded?: boolean
  createdWorkflowId?: string
}

function parseDraftPayload(content: string): DraftPayload | null {
  try {
    const p = JSON.parse(content) as DraftPayload
    if (p && p.v === 1 && typeof p.draftId === 'string' && typeof p.script === 'string') return p
  } catch {
    /* fall through — render the raw text */
  }
  return null
}

// One line for a broken card: lint.error covers parse/shape; a scan violation or unknown role may leave
// error null with ok=false — surface whichever gate actually failed.
function lintErrorLine(l: LintDto): string {
  if (l.error) return l.error
  if (l.scan && !l.scan.ok && l.scan.violations[0]) {
    const v = l.scan.violations[0]
    return `line ${v.line}: ${v.message}`
  }
  if (l.unknownRoles.length > 0) return `unknown or disabled role: ${l.unknownRoles.join(', ')}`
  return 'the script no longer passes checks'
}

export function WorkflowDraftCard({ content, expertId }: { content: string; expertId: string | null }): ReactElement {
  const t = useT()
  const { byId } = useAllExperts()
  const meta = useExpertMeta()
  const convId = useChat((s) => s.activeConv)
  const payload = parseDraftPayload(content)
  const script = payload?.script ?? ''
  const [lint, setLint] = useState<LintDto | null>(null)
  // Same-conversation same-name → the confirm UPDATES that workflow (§5.2); resolved against the live table.
  const [updateTarget, setUpdateTarget] = useState<boolean>(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showFlow, setShowFlow] = useState(false)

  // The card's live flips (superseded / created) ride the conv:card broadcast, whose store subscription
  // normally attaches on the first send(). A REOPENED conversation can reach this card without any send
  // this session — subscribe now (idempotent; the launch-review turn seeds the same way) or the confirm
  // click would patch the DB and every other window while THIS card stays visually stale until reload.
  useEffect(() => {
    useChat.getState().ensureStreamListeners()
  }, [])

  useEffect(() => {
    if (!script) return
    let alive = true
    void Promise.all([window.api.workflows.lint(script), window.api.workflows.list()])
      .then(([l, all]) => {
        if (!alive) return
        setLint(l)
        // Same key as main's §5.2 exemption: user-source + this conversation's provenance (a distilled
        // row sharing the originConvId is NOT the update target — main refuses that name outright).
        setUpdateTarget(!!l.name && !!convId && all.some((w) => w.name === l.name && w.originConvId === convId && w.source === 'user'))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [script, convId, payload?.createdWorkflowId])

  if (!payload) return <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{content}</p>

  const state: 'superseded' | 'created' | 'broken' | 'draft' = payload.superseded
    ? 'superseded'
    : payload.createdWorkflowId
      ? 'created'
      : lint && !lint.ok
        ? 'broken'
        : 'draft'
  const drafter = expertId ? meta(expertId) : null
  const name = lint?.name ?? '…'
  const flowOpen = state === 'draft' || state === 'broken' || showFlow

  const create = (): void => {
    if (!convId || busy) return
    setBusy(true)
    setErr(null)
    void (async () => {
      try {
        // Re-resolve create-vs-update AT CLICK TIME: another card's confirm (or another window) may have
        // created/deleted the same name since mount. If the true action differs from the label the user
        // just read, flip the label and stop — the next click confirms what will actually happen.
        const all = await window.api.workflows.list()
        const target = !!lint?.name && all.some((w) => w.name === lint.name && w.originConvId === convId && w.source === 'user')
        if (target !== updateTarget) {
          setUpdateTarget(target)
          return
        }
        const w = await window.api.workflows.createFromDraft({ convId, draftId: payload.draftId, script })
        toast.success(t('wfd.created', { name: w.name })) // the card flips via the conv:card patch broadcast
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    })()
  }
  const openEditor = (): void => {
    // Prefill only — the editor persists nothing until its own Save (assisted authoring §6.2).
    window.dispatchEvent(new CustomEvent('nsai:open-workflow-editor', { detail: { script } }))
  }
  const openCreated = (): void => {
    window.dispatchEvent(new CustomEvent('nsai:open-workflow-editor', { detail: { workflowId: payload.createdWorkflowId } }))
  }

  return (
    <div className={'wfd-card' + (state === 'superseded' ? ' superseded' : '')}>
      <div className="wfd-head">
        <span className="wfl-icon">
          <Icons.workflow size={14} />
        </span>
        <span className="wfl-name">{name}</span>
        {drafter && (
          <span className="name-chip" style={{ '--chip-color': drafter.color } as CSSProperties}>
            {drafter.name}
          </span>
        )}
        {state === 'draft' && <span className="wfd-badge">{t('wfd.draftBadge')}</span>}
        {state === 'created' && (
          <span className="wfd-badge ok">
            <Icons.check size={11} /> {t('wfd.created', { name })}
          </span>
        )}
        {state === 'superseded' && <span className="wfd-badge off">{t('wfd.superseded')}</span>}
        {(state === 'created' || state === 'superseded') && (
          <button className="wfd-flow-toggle" onClick={() => setShowFlow((v) => !v)}>
            {showFlow ? t('wfd.hideDiagram') : t('wfd.showDiagram')}
          </button>
        )}
      </div>
      {lint?.description && state !== 'superseded' ? <div className="wfd-desc">{lint.description}</div> : null}
      {flowOpen && lint ? <WorkflowFlow nodes={lint.nodes} params={lint.params} byId={byId} /> : null}
      {(state === 'draft' || state === 'broken') && lint && (lint.params.length > 0 || lint.cwd) ? (
        <div className="wfd-chips">
          {lint.params.map((p) => (
            <span key={p.name} className="wf-chip-mono">
              {p.name}: {p.type}
              {p.default !== undefined ? ` = ${String(p.default)}` : ''}
            </span>
          ))}
          {lint.cwd ? <span className="wf-chip-mono">cwd: {lint.cwd}</span> : null}
          {lint.cwdWarning ? (
            <span className="wfd-warn">{t(lint.cwdWarning === 'missing' ? 'wfd.cwdMissing' : 'wfd.cwdSensitive')}</span>
          ) : null}
        </div>
      ) : null}
      {state === 'broken' && lint ? (
        <div className="wfd-err">
          {lintErrorLine(lint)} — {t('wfd.brokenHint')}
        </div>
      ) : null}
      {err ? <div className="wfd-err">{t('wfd.confirmFailed', { message: err })}</div> : null}
      {state === 'draft' || state === 'broken' ? (
        <div className="wfd-actions">
          <button className="btn sm" disabled={busy || state === 'broken' || !convId || !lint} onClick={create}>
            {updateTarget ? t('wfd.update', { name }) : t('wfd.create')}
          </button>
          <button className="btn ghost sm" onClick={openEditor}>
            {t('wfd.openEditor')}
          </button>
        </div>
      ) : state === 'created' ? (
        <div className="wfd-actions">
          <button className="btn ghost sm" onClick={openCreated}>
            {t('wfd.open')} ›
          </button>
        </div>
      ) : null}
    </div>
  )
}
