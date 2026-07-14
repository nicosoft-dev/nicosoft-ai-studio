/* ============================================================
   NicoSoft AI Studio — research launch card (script-orchestration-alignment §4.1)
   A `/research <question>` run leaves this ONE card in the conversation and it carries the whole run: appended
   in a 'running' state and updated IN PLACE (over the conv:card channel) as phases/logs arrive and once the
   cited report lands. The card is a PURE function of its persisted JSON content — live progress and a reload
   long after the run both render from the same payload (no run row, no bespoke event stream). The report body
   uses the app's unified ChunkedMarkdown; the shell mirrors the workflow-card language (.wf-dot, mono chips).
   ============================================================ */
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { ChunkedMarkdown } from '@/components/markdown'

type ResearchStatus = 'running' | 'done' | 'failed' | 'stopped'

interface ResearchPayload {
  v?: number
  runId?: string
  question?: string
  status?: ResearchStatus
  phase?: string
  note?: string
  report?: string
  error?: string
}

function parsePayload(content: string): ResearchPayload | null {
  try {
    return JSON.parse(content) as ResearchPayload
  } catch {
    return null
  }
}

export function ResearchLaunchCard({ content }: { content: string }): ReactElement {
  const p = parsePayload(content)
  // A corrupt payload renders as its raw text (never a thrown card) — same fallback as the other cards.
  if (!p) return <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{content}</p>
  const status: ResearchStatus = p.status ?? 'running'
  const dotCls = status === 'running' ? ' run' : status === 'failed' ? ' err' : status === 'stopped' ? ' stop' : ''
  const stop = (): void => {
    if (p.runId) void window.api.research.stop(p.runId)
  }
  return (
    <div className="research-card">
      <div className="research-head">
        <span className="research-icon">
          <Icons.search size={14} />
        </span>
        <span className="research-q">{p.question ?? ''}</span>
        <span className="research-status">
          <span className={'wf-dot' + dotCls} />
          {status}
        </span>
        {status === 'running' && (
          <button className="research-stop" onClick={stop}>
            Stop
          </button>
        )}
      </div>
      {status === 'running' && (p.phase || p.note) ? (
        <div className="research-progress">
          {p.phase ? <span className="wf-chip-mono">{p.phase}</span> : null}
          {p.note ? <span className="research-note">{p.note}</span> : null}
        </div>
      ) : null}
      {status === 'done' && p.report ? (
        <div className="research-report">
          <ChunkedMarkdown text={p.report} live={false} />
        </div>
      ) : null}
      {status === 'failed' ? <div className="research-err">{p.error ?? 'Research failed.'}</div> : null}
      {status === 'stopped' ? <div className="research-note">Research stopped.</div> : null}
    </div>
  )
}
