// Workflow shape analysis — the NON-security static pass over a workflow script: materialize the meta
// mirror (name/description/params/cwd/nsw), extract the agent() role chain, count steps, collect phases,
// and project the read-only DAG the editor draws (phase groups / role nodes / parallel + loop flags).
// Pure: no Electron, no DB — role validity is checked against an INJECTED set so this unit-tests
// off-channel and the service supplies the live enabled-role set. Security lives in ./scanner; this
// module reports SHAPE problems (bad params, unknown role, reserved-name collision) as lint issues.

import { parseScript } from '../script/executor'
import { parseFull } from './scanner'
import type { Node } from 'acorn'
import type { WorkflowParamDto, WorkflowParamType } from '../../ipc/contracts'

type Ast = Node & { [k: string]: unknown }

// Params the ENGINE injects into args — a user param with the same name would be silently shadowed, so
// the collision is a parse-time lint error (workflow-design §3.1).
export const RESERVED_PARAMS = new Set(['runAt'])

const PARAM_TYPES = new Set<WorkflowParamType>(['string', 'number', 'boolean', 'folder'])

export interface FlowNode {
  kind: 'phase' | 'agent'
  line: number
  // phase
  title?: string
  // agent
  role?: string
  hint?: string // first chars of the prompt (literal/template text with ${…} placeholders)
  parallel?: boolean // inside a parallel()/pipeline() fan-out
  loop?: boolean // inside a while/for/for-of body
}

export interface WorkflowShape {
  name: string
  description: string
  params: WorkflowParamDto[]
  cwd: string | null
  nsw: number | null
  roles: string[] // distinct agent() roles in first-appearance order (the auto role chain)
  steps: number // static agent() call-site count
  phases: string[]
  nodes: FlowNode[] // source-order projection for the editor DAG
  issues: Array<{ line: number; message: string }> // shape/lint problems (non-security)
}

export type AnalyzeResult = { ok: true; shape: WorkflowShape } | { ok: false; error: string }

const lineOf = (n: Ast): number => ((n.loc as { start?: { line?: number } } | undefined)?.start?.line ?? 1)

// Flatten a template literal into display text with ${…} placeholders kept visible.
function templateText(n: Ast): string {
  const quasis = n.quasis as Ast[]
  const exprs = n.expressions as Ast[]
  let out = ''
  for (let i = 0; i < quasis.length; i++) {
    out += String((quasis[i].value as { cooked?: string }).cooked ?? '')
    if (i < exprs.length) out += '${…}'
  }
  return out
}

function promptHint(arg: Ast | undefined): string {
  if (!arg) return ''
  if (arg.type === 'Literal' && typeof arg.value === 'string') return arg.value
  if (arg.type === 'TemplateLiteral') return templateText(arg)
  return '(computed)'
}

// Materialize + validate meta.params into the WorkflowParamDto mirror. Bad entries become issues, not a
// hard failure — the editor shows the lint line while the user is mid-edit.
function readParams(raw: unknown, issues: WorkflowShape['issues']): WorkflowParamDto[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    issues.push({ line: 1, message: 'meta.params must be an array of { name, type, default?, label? }' })
    return []
  }
  const out: WorkflowParamDto[] = []
  const seen = new Set<string>()
  for (const p of raw) {
    if (!p || typeof p !== 'object') {
      issues.push({ line: 1, message: 'meta.params entries must be objects' })
      continue
    }
    const o = p as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      issues.push({ line: 1, message: `param name ${JSON.stringify(o.name)} must be a plain identifier` })
      continue
    }
    if (RESERVED_PARAMS.has(name)) {
      issues.push({ line: 1, message: `param name \`${name}\` is reserved (the engine injects args.${name})` })
      continue
    }
    if (seen.has(name)) {
      issues.push({ line: 1, message: `duplicate param \`${name}\`` })
      continue
    }
    const type = o.type as WorkflowParamType
    if (!PARAM_TYPES.has(type)) {
      issues.push({ line: 1, message: `param \`${name}\` has unknown type ${JSON.stringify(o.type)} — string | number | boolean | folder` })
      continue
    }
    const def = o.default
    if (def !== undefined && typeof def !== 'string' && typeof def !== 'number' && typeof def !== 'boolean') {
      issues.push({ line: 1, message: `param \`${name}\` default must be a scalar` })
      continue
    }
    seen.add(name)
    out.push({
      name,
      type,
      ...(def !== undefined ? { default: def as string | number | boolean } : {}),
      ...(typeof o.label === 'string' && o.label.trim() ? { label: o.label.trim() } : {}),
    })
  }
  return out
}

// Analyze a full workflow script. knownRoles, when provided, is the set of role ids a step may target
// (enabled agent-loop roles) — agent() calls outside it become lint issues.
export function analyze(src: string, knownRoles?: ReadonlySet<string>): AnalyzeResult {
  const parsed = parseScript(src, { allowEmptyDescription: true }) // workflow contract: '' → list shows the role chain
  if ('error' in parsed) return { ok: false, error: parsed.error }
  const full = parseFull(src)
  if ('error' in full) return { ok: false, error: full.error }

  const issues: WorkflowShape['issues'] = []
  const meta = parsed.meta
  const params = readParams(meta.params, issues)
  const cwd = typeof meta.cwd === 'string' && meta.cwd.trim() ? meta.cwd.trim() : null
  if (meta.cwd !== undefined && cwd === null) issues.push({ line: 1, message: 'meta.cwd must be a non-empty path string' })
  const nsw = typeof meta.nsw === 'number' && Number.isInteger(meta.nsw) ? meta.nsw : null

  const nodes: FlowNode[] = []
  const roles: string[] = []
  const phases: string[] = []
  let steps = 0

  // In-order walk with fan-out/loop context. phase() only shifts the projection when called with a
  // literal at the top flow (same currentPhase threading the engine does at runtime).
  const visit = (node: Ast | null, inParallel: boolean, inLoop: boolean): void => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return

    if (node.type === 'CallExpression') {
      const callee = node.callee as Ast
      const args = node.arguments as Ast[]
      if (callee.type === 'Identifier' && callee.name === 'phase') {
        const t = args[0]
        const title = t?.type === 'Literal' && typeof t.value === 'string' ? t.value : t?.type === 'TemplateLiteral' ? templateText(t) : '(dynamic)'
        phases.push(title)
        nodes.push({ kind: 'phase', title, line: lineOf(node) })
      }
      if (callee.type === 'Identifier' && callee.name === 'agent') {
        steps++
        const optsArg = args[1]
        let role: string | null = null
        if (optsArg?.type === 'ObjectExpression') {
          for (const p of optsArg.properties as Ast[]) {
            if (p.type !== 'Property' || p.computed) continue
            const key = p.key as Ast
            const keyName = key.type === 'Identifier' ? key.name : key.type === 'Literal' ? String(key.value) : ''
            if (keyName !== 'role') continue
            const v = p.value as Ast
            if (v.type === 'Literal' && typeof v.value === 'string' && v.value.trim()) role = v.value.trim()
          }
        }
        if (!role) {
          issues.push({ line: lineOf(node), message: 'agent() needs a literal role: agent(`…`, { role: \'analyst\' })' })
        } else {
          if (knownRoles && !knownRoles.has(role)) {
            issues.push({ line: lineOf(node), message: `unknown or disabled role \`${role}\`` })
          }
          if (!roles.includes(role)) roles.push(role)
        }
        nodes.push({ kind: 'agent', role: role ?? '?', hint: promptHint(args[0]).slice(0, 80), line: lineOf(node), parallel: inParallel, loop: inLoop })
      }
      // fan-out context: agent() thunks inside parallel()/pipeline() arguments render side-by-side
      const fanOut = callee.type === 'Identifier' && (callee.name === 'parallel' || callee.name === 'pipeline')
      for (const a of args) visit(a, inParallel || fanOut, inLoop)
      visit(callee.type === 'MemberExpression' ? (callee.object as Ast) : null, inParallel, inLoop)
      return
    }

    const loops = node.type === 'ForOfStatement' || node.type === 'ForStatement' || node.type === 'WhileStatement' || node.type === 'DoWhileStatement'
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'type') continue
      const child = node[key]
      if (Array.isArray(child)) for (const c of child) visit(c as Ast, inParallel, inLoop || loops)
      else if (child && typeof child === 'object' && 'type' in (child as object)) visit(child as Ast, inParallel, inLoop || loops)
    }
  }

  const body = full.ast.body as Ast[]
  for (let i = 0; i < body.length; i++) {
    if (i === 0 && body[i].type === 'ExportNamedDeclaration') continue // the meta export
    visit(body[i], false, false)
  }

  return {
    ok: true,
    shape: {
      name: meta.name,
      description: meta.description,
      params,
      cwd,
      nsw,
      roles,
      steps,
      phases,
      nodes,
      issues,
    },
  }
}
