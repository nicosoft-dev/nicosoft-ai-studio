/* ============================================================
   NicoSoft AI Studio — workflow flow diagram (read-only DAG projection)
   Extracted from views/workflows.tsx so the editor's right pane and the in-chat
   workflow DRAFT card render the SAME deterministic projection of lint(script).nodes
   (workflow-assisted-authoring §6.3) — the diagram can never drift from the script.
   cursorLine/onNode are the editor's node ⇄ script-line sync; the card omits both.
   ============================================================ */
import type { ReactElement } from 'react'
import { Avatar } from '@/components/primitives'

type LintDto = Awaited<ReturnType<typeof window.api.workflows.lint>>
export type WorkflowFlowNode = LintDto['nodes'][number]
export type WorkflowFlowParam = LintDto['params'][number]

export function WorkflowFlow({
  nodes,
  params,
  byId,
  cursorLine,
  onNode,
}: {
  nodes: WorkflowFlowNode[]
  params: WorkflowFlowParam[]
  byId: Record<string, { id: string; name: string; color: string } & object>
  cursorLine?: number
  onNode?: (line: number) => void
}): ReactElement {
  // group agent nodes under their preceding phase; adjacent parallel agents share a row
  const groups: { title: string | null; line: number; rows: WorkflowFlowNode[][] }[] = []
  let cur: { title: string | null; line: number; rows: WorkflowFlowNode[][] } = { title: null, line: 0, rows: [] }
  for (const n of nodes) {
    if (n.kind === 'phase') {
      if (cur.rows.length || cur.title) groups.push(cur)
      cur = { title: n.title ?? '', line: n.line, rows: [] }
      continue
    }
    const lastRow = cur.rows[cur.rows.length - 1]
    if (n.parallel && lastRow && lastRow[lastRow.length - 1]?.parallel) lastRow.push(n)
    else cur.rows.push([n])
  }
  if (cur.rows.length || cur.title) groups.push(cur)
  const argsChip = params.length ? params.map((p) => `${p.name}${p.default !== undefined ? ` = ${p.default}` : ''}`).join(' · ') : 'no params'
  // the node whose line is closest at-or-before the cursor gets the selection ring (editor only)
  const agentLines = nodes.filter((n) => n.kind === 'agent').map((n) => n.line)
  const selLine = cursorLine === undefined ? -1 : (agentLines.filter((l) => l <= cursorLine).pop() ?? -1)

  return (
    <div className="wf-dag">
      <span className="wf-dag-start">▶ args: {argsChip}</span>
      {groups.map((g, gi) => (
        <div key={gi} className="wf-dag-seq">
          <span className="wf-dag-edge" />
          <div className={'wf-dag-phase' + (g.title === null ? ' bare' : '')}>
            {g.title !== null && <em>{(g.title || ' ').toUpperCase()}</em>}
            {g.rows.map((row, ri) => (
              <div key={ri} className="wf-dag-row">
                {row.map((n, ni) => {
                  const e = byId[n.role ?? '']
                  return (
                    <button key={ni} className={'wf-dag-node' + (n.line === selLine ? ' sel' : '')} onClick={() => onNode?.(n.line)}>
                      {e ? <Avatar expert={e as never} size={22} /> : <span className="wf-dag-q">?</span>}
                      <span className="wf-dag-body">
                        {e?.name ?? n.role}
                        {n.loop && <span className="wf-dag-loop" title="inside a loop">↻</span>}
                        <small>{n.hint || '…'}</small>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      <span className="wf-dag-edge" />
      <span className="wf-dag-start">return</span>
    </div>
  )
}
