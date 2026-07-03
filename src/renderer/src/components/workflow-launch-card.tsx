/* ============================================================
   NicoSoft AI Studio — workflow launch card (workflow-design §6.5, W2)
   A `/workflow` command run from the composer leaves this card in the conversation: name + params +
   LIVE status, linking to the run panel. The card is a persisted message row (segmentKind =
   'workflow-launch', content = JSON payload) — the status is NOT persisted with it; the card reads it
   from the run row on mount and follows `workflow:run:event` while the run is live, so an old card
   reopened later still shows the run's true outcome.
   ============================================================ */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { useT } from '@/stores/locale'
import { parseLaunchPayload } from '@/lib/workflow-command'

type RunStatus = 'running' | 'ok' | 'failed' | 'stopped'

export function WorkflowLaunchCard({ content }: { content: string }): ReactElement {
  const t = useT()
  const payload = parseLaunchPayload(content)
  const [status, setStatus] = useState<RunStatus | null>(null)
  const [failReason, setFailReason] = useState<string | null>(null)
  const runId = payload?.runId
  useEffect(() => {
    if (!runId) return
    let alive = true
    // The run row is the source of truth (covers reload long after the run settled); the event stream
    // then keeps a live run's status fresh without polling. A deleted workflow cascades its runs away —
    // runGet null renders as a dash (the card still documents what was launched).
    void window.api.workflows.runGet(runId).then((r) => {
      if (alive && r) {
        setStatus(r.status)
        setFailReason(r.failReason)
      }
    })
    const off = window.api.workflows.onRunEvent((ev) => {
      if (ev.kind === 'status' && ev.runId === runId) {
        setStatus(ev.status)
        setFailReason(ev.failReason ?? null)
      }
    })
    return () => {
      alive = false
      off()
    }
  }, [runId])
  if (!payload) return <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{content}</p>
  const open = (): void => {
    window.dispatchEvent(
      new CustomEvent('nsai:open-workflow-run', { detail: { workflowId: payload.workflowId, runId: payload.runId } })
    )
  }
  const dotCls = status === 'running' ? ' run' : status === 'failed' ? ' err' : status === 'stopped' || !status ? ' stop' : ''
  const entries = Object.entries(payload.params)
  return (
    <button className="wfl-card" onClick={open} title={t('wf.openPanel')}>
      <span className="wfl-icon">
        <Icons.workflow size={14} />
      </span>
      <span className="wfl-name">{payload.name}</span>
      {entries.map(([k, v]) => (
        <span key={k} className="wf-chip-mono wfl-param">
          {k}={String(v)}
        </span>
      ))}
      <span className="wfl-status">
        <span className={'wf-dot' + dotCls} />
        {status ?? '—'}
        {status === 'failed' && failReason ? ` (${failReason})` : ''}
      </span>
      <span className="wfl-open">{t('wf.openPanel')}</span>
    </button>
  )
}
