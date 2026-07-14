// ScriptRunCard — the foldable Tasks-panel render for a role-driven script fan-out (research-role-driven-redesign
// §4.5): studio_research / studio_design (and studio_migrate later). Sibling of LensCard; reuses the exact same
// chrome (.pe-card / .pe-head-row / the breathing .tr-dot / the .tr-chev chevron / the .pe-stop Stop button) — no
// new widgets. The card is a top-level 'Studio<Kind>' tool the Tasks panel collects; its sub-tools are the script
// PHASES the executor announces via onPhase, each carrying a live summary from onLog. The result itself is NOT on
// the card — the driving role reports it in its chat turn (tool_result → chat message).
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'
import type { ToolCall } from '@/stores/chat'

// 'StudioResearch' → 'studio_research', 'StudioDesign' → 'studio_design', etc. — the on-card tool label.
const toolLabel = (name: string): string => name.replace(/^Studio/, 'studio_').toLowerCase()
// The one free-text subject each kind carries under its own input key.
const subjectOf = (input: Record<string, unknown>): string =>
  String(input.question ?? input.problem ?? input.instruction ?? '')

export function ScriptRunCard({ tool, convId }: { tool: ToolCall; convId?: string }): ReactElement {
  const [open, setOpen] = useState(true)
  const input = (tool.input ?? {}) as Record<string, unknown>
  const running = tool.status === 'running'
  const phases = tool.subTools ?? []
  const doneN = phases.filter((p) => p.status !== 'running').length
  const subject = subjectOf(input)
  return (
    <div className="pe-card">
      <div className="pe-head-row">
        <button className="pe-head" onClick={() => setOpen((o) => !o)}>
          {running ? <span className="tr-dot" /> : null}
          <span className="pe-name">{toolLabel(tool.name)}</span>
          <span className="pe-sep">·</span>
          <span className="pe-meta">{subject || '…'}</span>
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
        {running && convId && typeof input.asyncHandleId === 'string' ? (
          <button
            className="icon-btn sm pe-stop"
            title="Stop"
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
              <span className="pe-summary">{running ? 'starting…' : ''}</span>
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
