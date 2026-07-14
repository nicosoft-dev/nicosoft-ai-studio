// ResearchCard — the foldable render for a studio_research fan-out (research-role-driven-redesign §4.5), the
// sibling of LensCard. It reuses the exact same chrome (.pe-card / .pe-head-row / the breathing .tr-dot / the
// .tr-chev chevron / the P0 .pe-stop Stop button) — no new widgets. The card is a top-level 'StudioResearch'
// tool the Tasks panel collects; its sub-tools are the research PHASES (Scope → Search → Fetch → Verify →
// Synthesize) the deep-research script announces via onPhase, each carrying a live summary from onLog. The cited
// report itself is NOT on the card — the driving role reports it in its chat turn (tool_result → chat message).
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'
import type { ToolCall } from '@/stores/chat'

export function ResearchCard({ tool, convId }: { tool: ToolCall; convId?: string }): ReactElement {
  const [open, setOpen] = useState(true)
  const input = (tool.input ?? {}) as { question?: string; asyncHandleId?: string }
  const running = tool.status === 'running'
  const phases = tool.subTools ?? []
  const doneN = phases.filter((p) => p.status !== 'running').length
  return (
    <div className="pe-card">
      <div className="pe-head-row">
        <button className="pe-head" onClick={() => setOpen((o) => !o)}>
          {running ? <span className="tr-dot" /> : null}
          <span className="pe-name">studio_research</span>
          <span className="pe-sep">·</span>
          <span className="pe-meta">{input.question || '…'}</span>
          {phases.length > 0 ? (
            <>
              <span className="pe-sep">·</span>
              <span className="pe-meta">{doneN}/{phases.length}</span>
            </>
          ) : null}
          <span className={'tr-chev pe-chev' + (open ? ' open' : '')}>
            <Icons.chevronRight size={12} />
          </span>
        </button>
        {/* Tasks-panel Stop for a live, addressable handle only (a persisted/reloaded card has no convId+handleId). */}
        {running && convId && input.asyncHandleId ? (
          <button
            className="icon-btn sm pe-stop"
            title="Stop this research"
            onClick={() => void window.api.async.stopHandle(convId, input.asyncHandleId as string)}
          >
            <Icons.x size={14} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="pe-body">
          {phases.length === 0 ? (
            <div className="pe-row">
              <span className="pe-row-dot">{running ? <span className="tr-dot" /> : null}</span>
              <span className="pe-subject">{running ? 'starting' : 'idle'}</span>
              <span className="pe-summary">{running ? 'starting the research…' : ''}</span>
            </div>
          ) : (
            phases.map((p) => {
              const pin = (p.input ?? {}) as { lastToolSummary?: string }
              return (
                <div key={p.id} className="pe-row">
                  <span className="pe-row-dot">{p.status === 'running' ? <span className="tr-dot" /> : null}</span>
                  <span className="pe-subject">{p.name}</span>
                  {pin.lastToolSummary ? <span className="pe-summary">{pin.lastToolSummary}</span> : null}
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
