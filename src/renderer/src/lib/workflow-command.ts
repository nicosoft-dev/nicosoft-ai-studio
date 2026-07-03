/* ============================================================
   NicoSoft AI Studio — /workflow composer command (workflow-design §6.5 / §7 W2)
   Pure logic for the palette entries and the inline `key=value` argument grammar — no React, no window,
   no path aliases, so the e2e harness imports this file directly (node type-stripping) and pins the
   red lines: draft/disabled workflows never become commands; the arg parser's full matrix.
   ============================================================ */

// Structural mini-shapes (WorkflowDto is assignable): keeps this module dependency-free for the harness.
export interface WfCmdParam {
  name: string
  type: 'string' | 'number' | 'boolean' | 'folder'
  default?: string | number | boolean
}
export interface WfCmdWorkflow {
  id: string
  name: string
  description: string
  enabled: boolean
  params: WfCmdParam[]
  roles: string[]
}

// One palette entry: `name`/`desc` render like any slash command, `params` is the right-aligned
// defaults preview, `complete` is what Tab puts in the composer for inline editing (absent = no params,
// Tab just runs like every other command).
export interface WorkflowCommandSpec<W extends WfCmdWorkflow = WfCmdWorkflow> {
  wf: W
  name: string
  desc: string
  params?: string
  complete?: string
}

// A default value as a `key=value` token: quote when it has whitespace (the parser reads "..." back).
// A value that itself contains a double-quote can't be round-tripped by the v1 grammar — fall back to
// bare (spaces would then split it; authored defaults are expected to stay simple).
function tokenValue(v: string | number | boolean | undefined): string {
  const s = v === undefined ? '' : String(v)
  return /\s/.test(s) && !s.includes('"') ? `"${s}"` : s
}

// §9 red line: only ENABLED workflows surface as commands — imported/distilled drafts and switched-off
// rows never appear in the palette (they still run from the list page once reviewed + enabled).
export function workflowCommandSpecs<W extends WfCmdWorkflow>(list: W[]): WorkflowCommandSpec<W>[] {
  return list
    .filter((w) => w.enabled)
    .map((w) => ({
      wf: w,
      name: `workflow ${w.name}`,
      desc: w.description || w.roles.join(' → '),
      params: w.params.length ? w.params.map((p) => `${p.name}=${tokenValue(p.default)}`).join(' ') : undefined,
      complete: w.params.length
        ? `/workflow ${w.name} ${w.params.map((p) => `${p.name}=${tokenValue(p.default)}`).join(' ')}`
        : undefined
    }))
}

export type WorkflowArgError =
  | { kind: 'malformed'; token: string } // a token that isn't key=value at all
  | { kind: 'unknown'; name: string } // key that isn't a declared param (typo protection — never silently dropped)
  | { kind: 'missing'; name: string } // no value provided and the param has no default
  | { kind: 'bad-value'; name: string } // value doesn't parse as the declared type

export type WorkflowArgsResult =
  | { ok: true; values: Record<string, string | number | boolean> }
  | { ok: false; error: WorkflowArgError }

// `url=https://x days=7 note="two words"` → typed values, defaults filling the gaps. Grammar: whitespace-
// separated `key=value` tokens, value either bare (no spaces) or "double-quoted" (no escapes).
export function parseWorkflowArgs(params: WfCmdParam[], arg: string | undefined): WorkflowArgsResult {
  const provided: Record<string, string> = {}
  const src = (arg ?? '').trim()
  if (src) {
    // Tokenize on whitespace OUTSIDE quotes: a quoted value keeps its spaces.
    const tokens = src.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
    for (const token of tokens) {
      const m = /^([A-Za-z_][\w-]*)=(?:"([^"]*)"|(.*))$/s.exec(token)
      if (!m) return { ok: false, error: { kind: 'malformed', token } }
      const name = m[1]
      if (!params.some((p) => p.name === name)) return { ok: false, error: { kind: 'unknown', name } }
      provided[name] = m[2] ?? m[3] ?? ''
    }
  }
  const values: Record<string, string | number | boolean> = {}
  for (const p of params) {
    const raw = Object.prototype.hasOwnProperty.call(provided, p.name) ? provided[p.name] : p.default
    // A folder needs a real path — typed-out empty (`dir=`) reads as "not provided", falls to the default.
    const empty = raw === undefined || (typeof raw === 'string' && raw.trim() === '' && p.type !== 'string')
    if (empty) {
      if (p.type !== 'string') return { ok: false, error: { kind: 'missing', name: p.name } }
      values[p.name] = typeof raw === 'string' ? raw : ''
      continue
    }
    if (p.type === 'number') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (!Number.isFinite(n)) return { ok: false, error: { kind: 'bad-value', name: p.name } }
      values[p.name] = n
    } else if (p.type === 'boolean') {
      if (typeof raw === 'boolean') values[p.name] = raw
      else {
        const s = String(raw).trim().toLowerCase()
        if (s !== 'true' && s !== 'false') return { ok: false, error: { kind: 'bad-value', name: p.name } }
        values[p.name] = s === 'true'
      }
    } else {
      values[p.name] = String(raw)
    }
  }
  return { ok: true, values }
}

// The persisted launch-card payload (message content, segmentKind='workflow-launch'). Versioned so a
// future shape change can keep rendering old cards.
export interface WorkflowLaunchPayload {
  v: 1
  workflowId: string
  runId: string
  name: string
  params: Record<string, string | number | boolean>
}

export function launchPayload(workflowId: string, runId: string, name: string, params: Record<string, string | number | boolean>): string {
  return JSON.stringify({ v: 1, workflowId, runId, name, params } satisfies WorkflowLaunchPayload)
}

export function parseLaunchPayload(content: string): WorkflowLaunchPayload | null {
  try {
    const p = JSON.parse(content) as WorkflowLaunchPayload
    if (p && p.v === 1 && typeof p.workflowId === 'string' && typeof p.runId === 'string' && typeof p.name === 'string' && p.params && typeof p.params === 'object')
      return p
    return null
  } catch {
    return null
  }
}
