// Studio Lens — the node:vm script executor (批 1: sandbox skeleton, no primitives/bridge yet).
//
// This is the engine half of the lens rewrite: the reviewer AUTHORS a deterministic JS orchestration
// script (批 4) and this module SAFELY EXECUTES it — replacing the old YAML-engine auto-fan-out. It is a
// faithful reimplementation of Claude Code's Workflow tool execution engine, decoded verbatim from the
// cc 2.1.186 binary (~/.local/share/claude/versions/2.1.186, strings offsets cited inline). Aligning to
// the REAL running binary — not speculation — is the hard rule here.
//
// 批 1 scope (this file,纯函数, off-channel): parse + validate the `export const meta` header, transpile
// the body, build the hardened node:vm sandbox, and run a PURE-COMPUTATION script (args in, return value
// out). The orchestration primitives (agent/parallel/pipeline) and the cross-realm async bridge
// (bindVMAwait) are 批 2 — this file deliberately injects NONE of them yet, so a script that calls agent()
// gets a ReferenceError until 批 2 wires it.
//
// Binary alignment map (cc 2.1.186):
//   • sandbox       — createContext({__proto__:null},{codeGeneration:{strings:false,wasm:false}})   @20146026 / @20297222
//   • harden (X6e)  — delete 14 dangerous globals + freeze Error.prepareStackTrace                  @20134844 / @20135037
//   • date/rand shim— Math.random/Date.now throw + ShimDate (bare/no-arg throw, arg'd OK)            @20285503 / @20285669
//   • meta validate — acorn parse(sourceType:module) → body[0] ExportNamedDeclaration → pure-literal @20292504 / @20286344
//   • pure-literal  — PKa/OKa/yBp recursive (Literal/Array/Object/Template-no-interp/neg-number)     @20292400
//   • transpile     — slice off meta decl; wrap body in `(async () => {'use strict'; … })()`         @20281990 (fBp)
//   • execute       — new vm.Script(wrapped,{importModuleDynamically:throw}); runInContext{timeout}  @20284800 / @20297222
//   • settle bridge — runInContext('(async v => ({__proto__:null, v: await v}))')                    @20142011 (Apt)

import vm from 'node:vm'
import { parse, type Node } from 'acorn'
import * as walk from 'acorn-walk'

// acorn's Node type is intentionally loose (estree shapes aren't bundled); widen for property access and
// rely on the RUNTIME node.type checks below (which is exactly what the binary's validator does too).
type Ast = Node & { [k: string]: unknown }

// ── Constants (verbatim from cc 2.1.186) ────────────────────────────────────────────────────────────────

// xqn=30000 — the vm.Script runInContext timeout. NOTE: a vm timeout bounds the SYNCHRONOUS portion only
// (it cannot interrupt an awaited microtask); it's a runaway-sync backstop, not an overall wall-clock. The
// async budget is governed elsewhere (批 2 agent cap / abort signal). 30s mirrors the Workflow default.
export const LENS_SCRIPT_TIMEOUT_MS = 30_000

// Rp="__wRg$" — the reserved internal-variable prefix (binary @20284800). The transpiler rejects any
// user identifier starting with it so a script can't collide with / shadow the bridge variables 批 2 injects.
const RESERVED_PREFIX = '__wRg$'

// X6e (@20135037): globals with no orchestration use case that either run host-loop callbacks outside any
// try/catch (FinalizationRegistry — DoS shape) or expose shared-memory / debug-shell primitives (pure
// attack-surface reduction). eval/Function are NOT deleted here — they're blocked harder by the context's
// codeGeneration:false (createContext option below), which makes `Function('…')` throw at construction.
const DELETED_GLOBALS = [
  'ShadowRealm', 'WebAssembly', 'FinalizationRegistry', 'WeakRef', 'Atomics', 'SharedArrayBuffer',
  'queueMicrotask', '$vm', 'gc', 'edenGC', 'fullGC', 'print', 'readFile', 'Loader',
]

// Reserved meta key names (gBp): block prototype-pollution vectors even though OKa builds onto a
// null-prototype object — defense in depth.
const RESERVED_META_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

// X6e harden prelude — run INSIDE the vm realm (so it hardens the script's globals, not the host's).
// Freezes Error.prepareStackTrace (deny stack-trace callback as an escape vector) and deletes the
// dangerous globals. Shape from @20134844, MINUS the SES-style prototype freeze + enable-override the
// binary also does: a vm context gets its OWN intrinsics (a script polluting its Object.prototype can't
// reach the host's), and every review builds a FRESH context, so self-pollution neither escapes nor
// persists. The freeze is defense-in-depth (keeps a script from corrupting its own orchestration); 批 2
// adds it alongside the bridge, which depends on clean intrinsics.
const HARDEN_PRELUDE = `(() => {
  Object.defineProperty(Error, 'prepareStackTrace', {
    value: (err) => String((err && err.stack) ?? err),
    writable: false, configurable: false,
  });
  for (const g of ${JSON.stringify(DELETED_GLOBALS)}) {
    try { delete globalThis[g] } catch {}
  }
})()`

// Date/Math.random shim (mBp @20285503) — disable non-deterministic sources so a review over the same diff
// is reproducible (the binary's stated reason is resume-safety; lens has no resume, but the same
// determinism makes reviews testable + stops scripts keying behavior off wall-clock). `new Date(ts)` with
// an explicit argument is still allowed (parsing a passed-in timestamp); only Date.now()/`new Date()` (no
// arg)/bare `Date()` throw. ShimDate logic verbatim from @20285669.
const NOW_ERR =
  'Date.now() / new Date() are unavailable in lens scripts (reproducibility). Pass any needed timestamp via args.'
const RANDOM_ERR =
  'Math.random() is unavailable in lens scripts (reproducibility). For N independent samples, include the index in the agent label or prompt.'
const DATE_RANDOM_SHIM = `(() => {
  const NOW_ERR = ${JSON.stringify(NOW_ERR)};
  const RANDOM_ERR = ${JSON.stringify(RANDOM_ERR)};
  Math.random = function random() { throw new Error(RANDOM_ERR) };
  const RealDate = Date;
  RealDate.now = function now() { throw new Error(NOW_ERR) };
  function ShimDate(...a) {
    if (!new.target) throw new Error(NOW_ERR);   // bare Date() → now-string
    if (a.length === 0) throw new Error(NOW_ERR); // new Date() with no args
    return Reflect.construct(RealDate, a, new.target); // new Date(ts) OK
  }
  ShimDate.now = RealDate.now;
  ShimDate.parse = RealDate.parse;
  ShimDate.UTC = RealDate.UTC;
  ShimDate.prototype = RealDate.prototype;
  RealDate.prototype.constructor = ShimDate; // close the (new Date(x)).constructor backdoor
  Object.freeze(RealDate);                    // …then freeze so it can't be undone
  globalThis.Date = ShimDate;
})()`

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ScriptMeta {
  name: string
  description: string
  whenToUse?: string
  phases?: unknown
  [k: string]: unknown
}

export type ParseResult = { meta: ScriptMeta; scriptBody: string } | { error: string }

// ── meta validation + transpile (acorn) ─────────────────────────────────────────────────────────────────

// _Bp (@20292504): the first statement must be `export const meta = { … }` — exactly one const declarator
// named `meta` whose init is an object literal.
function isMetaExport(node: Ast): boolean {
  const decl = node.declaration as Ast | undefined
  if (!decl || decl.type !== 'VariableDeclaration') return false
  if (decl.kind !== 'const') return false
  const decls = decl.declarations as Ast[]
  if (!Array.isArray(decls) || decls.length !== 1) return false
  const d = decls[0]
  const id = d.id as Ast
  const init = d.init as Ast | undefined
  return id?.type === 'Identifier' && id.name === 'meta' && init?.type === 'ObjectExpression'
}

// yBp (@20292400): extract a property key (Identifier or Literal), rejecting reserved/pollution names.
function literalKey(prop: Ast): string {
  const key = prop.key as Ast
  let name: string
  if (key.type === 'Identifier') name = key.name as string
  else if (key.type === 'Literal') name = String(key.value)
  else throw new Error(`unsupported key type in meta: ${key.type}`)
  if (RESERVED_META_KEYS.has(name)) throw new Error(`reserved key name not allowed in meta: ${name}`)
  return name
}

// PKa (@20292400): recursively materialize a PURE-LITERAL node into its JS value, or throw. Allowed:
// Literal, Array (no holes/spread), Object, TemplateLiteral (no interpolation), negative-number unary.
// Anything else (Identifier, Call, spread, …) means meta isn't a pure literal → throw → caller reports it.
function literalValue(node: Ast): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value
    case 'ArrayExpression':
      return (node.elements as (Ast | null)[]).map((el) => {
        if (el === null) throw new Error('sparse arrays not allowed in meta')
        if (el.type === 'SpreadElement') throw new Error('spread not allowed in meta')
        return literalValue(el)
      })
    case 'ObjectExpression':
      return literalObject(node)
    case 'TemplateLiteral': {
      const expr = node.expressions as Ast[]
      if (expr.length > 0) throw new Error('template interpolation not allowed in meta')
      const quasis = node.quasis as Ast[]
      return quasis.map((q) => ((q.value as { cooked?: string }).cooked ?? '')).join('')
    }
    case 'UnaryExpression': {
      const arg = node.argument as Ast
      if (node.operator === '-' && arg.type === 'Literal' && typeof arg.value === 'number') return -arg.value
      throw new Error('only negative-number unary allowed in meta')
    }
    default:
      throw new Error(`non-literal node type in meta: ${node.type}`)
  }
}

// OKa (@20292400): build a null-prototype object from an ObjectExpression's plain (non-computed,
// non-method, init-kind) properties.
function literalObject(node: Ast): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null)
  for (const p of node.properties as Ast[]) {
    if (p.type !== 'Property') throw new Error('only plain properties allowed in meta')
    if (p.computed) throw new Error('computed keys not allowed in meta')
    if (p.method || p.kind !== 'init') throw new Error('methods/accessors not allowed in meta')
    out[literalKey(p)] = literalValue(p.value as Ast)
  }
  return out
}

// TBp (@20292504): required meta fields. name + description are mandatory non-empty strings (name shows in
// the permission dialog / run list, description is the one-liner). phases/whenToUse are optional.
function validateMetaFields(meta: Record<string, unknown>): string | null {
  if (typeof meta.name !== 'string' || !meta.name.trim()) return 'meta.name must be a non-empty string'
  if (typeof meta.description !== 'string' || !meta.description.trim()) return 'meta.description must be a non-empty string'
  return null
}

// Parse + validate the script header, returning the materialized meta and the body with the meta
// declaration sliced off. Mirrors the binary's validator (@20292504) exactly: acorn parse as a module
// (so `export` is legal) with top-level await/return allowed, first statement must be the meta export,
// then strip it to get the executable body.
export function parseScript(src: string): ParseResult {
  let ast: Ast
  try {
    ast = parse(src, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }) as unknown as Ast
  } catch (e) {
    return {
      error:
        `Script parse error: ${e instanceof Error ? e.message : String(e)}. ` +
        'Lens scripts must be plain JavaScript — TypeScript syntax (type annotations like `: string[]`, ' +
        'interfaces, generics) fails to parse.',
    }
  }
  const first = (ast.body as Ast[])[0]
  if (!first || first.type !== 'ExportNamedDeclaration' || !isMetaExport(first)) {
    return { error: '`export const meta = { name, description, phases }` must be the FIRST statement in the script' }
  }
  const decl = first.declaration as Ast
  const init = (decl.declarations as Ast[])[0].init as Ast
  let raw: Record<string, unknown>
  try {
    raw = literalObject(init)
  } catch (e) {
    return { error: `meta must be a pure literal: ${e instanceof Error ? e.message : String(e)}` }
  }
  const fieldError = validateMetaFields(raw)
  if (fieldError) return { error: fieldError }
  // Strip the meta declaration: everything after its end, with a leading `;`/blank line trimmed (@20292504).
  const scriptBody = src.slice(first.end).replace(/^[;\s]*\n/, '').trimStart()
  return { meta: raw as ScriptMeta, scriptBody }
}

// fBp (@20281990): wrap the body in an async IIFE under strict mode so top-level await + top-level return
// are legal and the return value is the IIFE's resolution. Then re-parse the WRAPPED form as a script and
// walk every identifier to reject the reserved `__wRg$` prefix (collision guard for 批 2's bridge vars).
export function transpile(scriptBody: string): { code: string } | { error: string } {
  const code = `(async () => {'use strict';\n${scriptBody}\n})()`
  let wrappedAst: Ast
  try {
    wrappedAst = parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }) as unknown as Ast
  } catch (e) {
    return { error: `Script body parse error: ${e instanceof Error ? e.message : String(e)}` }
  }
  let reserved: string | null = null
  walk.full(wrappedAst as never, (node) => {
    const n = node as unknown as Ast
    if (n.type === 'Identifier' && typeof n.name === 'string' && n.name.startsWith(RESERVED_PREFIX)) {
      reserved = n.name
    }
  })
  if (reserved) return { error: `Identifier '${reserved}' is reserved (the '${RESERVED_PREFIX}' prefix is internal).` }
  return { code }
}

// HKa (@20286344): a friendly STATIC pre-check — does the body statically reference Date.now / Math.random
// / no-arg `new Date()`? The runtime shim already throws on these, but flagging them statically gives a
// clearer signal than a deep-in-execution throw. Non-fatal: returns the offending names (caller may warn).
export function detectNonDeterminism(scriptBody: string): string[] {
  const found = new Set<string>()
  let ast: Ast
  try {
    ast = parse(scriptBody, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }) as unknown as Ast
  } catch {
    return []
  }
  walk.simple(ast as never, {
    MemberExpression(node) {
      const n = node as unknown as Ast
      const obj = n.object as Ast
      const prop = n.property as Ast
      if (n.computed || obj.type !== 'Identifier' || prop.type !== 'Identifier') return
      if (obj.name === 'Date' && prop.name === 'now') found.add('Date.now')
      if (obj.name === 'Math' && prop.name === 'random') found.add('Math.random')
    },
    NewExpression(node) {
      const n = node as unknown as Ast
      const callee = n.callee as Ast
      if (callee.type === 'Identifier' && callee.name === 'Date' && (n.arguments as unknown[]).length === 0) {
        found.add('new Date()')
      }
    },
  })
  return [...found]
}

// ── sandbox ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SandboxHooks {
  // 批 1 surface: orchestration logging only. agent/parallel/pipeline arrive in 批 2.
  log?: (msg: string) => void
  phase?: (title: string) => void
}

// Build the hardened vm context (@20297222 main path): null-prototype sandbox with code generation
// disabled (eval/Function throw → blocks the classic `constructor.constructor('return process')()` escape),
// then run the harden + date/random preludes INSIDE the realm, then inject args + log/phase. Returns the
// context ready for a compiled vm.Script.
export function createLensSandbox(args: unknown, hooks: SandboxHooks = {}): vm.Context {
  const ctx = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  })
  // Harden the realm's intrinsics, then disable non-deterministic sources. Order matches the binary
  // (Iqn(f) then X6e(f) at @20297222); either order is safe since they touch disjoint globals.
  vm.runInContext(DATE_RANDOM_SHIM, ctx, { filename: 'lens:shim' })
  vm.runInContext(HARDEN_PRELUDE, ctx, { filename: 'lens:harden' })

  // args injection (@20298180 uses a cross-realm clone bridge; 批 1 uses a JSON-safe host deep-clone — args
  // are plain data, and the clone severs any aliasing back to the host object. 批 2 swaps in the real clone
  // bridge for non-JSON values). undefined stays undefined.
  const clonedArgs = args === undefined ? undefined : JSON.parse(JSON.stringify(args))
  Object.defineProperty(ctx, 'args', { value: clonedArgs, writable: true, enumerable: true, configurable: true })

  const log = hooks.log ?? (() => {})
  const phase = hooks.phase ?? (() => {})
  Object.defineProperty(ctx, 'log', {
    value: (m: unknown) => log(typeof m === 'string' ? m : `[${typeof m}]`),
    writable: true, enumerable: true, configurable: true,
  })
  Object.defineProperty(ctx, 'phase', {
    value: (t: unknown) => phase(typeof t === 'string' ? t : String(t)),
    writable: true, enumerable: true, configurable: true,
  })
  return ctx
}

// ── execute ─────────────────────────────────────────────────────────────────────────────────────────────

export interface RunScriptOptions {
  src: string
  args?: unknown
  hooks?: SandboxHooks
  timeoutMs?: number
}

export type RunScriptResult = { ok: true; meta: ScriptMeta; value: unknown } | { ok: false; error: string }

// The 批 1 end-to-end path (no primitives): parse+validate → transpile → sandbox → compile → run → settle.
// A pure-computation script (args in, value out) proves the sandbox, the transpile, the determinism shim,
// and args injection. Scripts that call agent()/parallel()/pipeline() ReferenceError until 批 2.
export async function runScript(opts: RunScriptOptions): Promise<RunScriptResult> {
  const parsed = parseScript(opts.src)
  if ('error' in parsed) return { ok: false, error: parsed.error }

  const t = transpile(parsed.scriptBody)
  if ('error' in t) return { ok: false, error: t.error }

  let script: vm.Script
  try {
    script = new vm.Script(t.code, {
      filename: 'lens-script.js',
      // import() is unavailable — a lens script is self-contained, not a module loader (@20284800).
      importModuleDynamically: (() => {
        throw new Error('import() is not available in lens scripts.')
      }) as never,
    })
  } catch (e) {
    return { ok: false, error: `Script compile error: ${e instanceof Error ? e.message : String(e)}` }
  }

  // Sandbox build + settle bridge + execution all live inside one try, so any failure — an args-clone error
  // (e.g. a circular value), a prelude throw, a script throw, or a sync-timeout — degrades to ok:false
  // instead of escaping runScript.
  try {
    const ctx = createLensSandbox(opts.args, opts.hooks)
    // Apt settle bridge (@20142011): the wrapped IIFE returns a vm-realm Promise. Awaiting a cross-realm
    // thenable directly is brittle, so we await it INSIDE the realm via a tiny helper that hands back a
    // null-prototype { v } envelope — the host then reads `.v`.
    const settle = vm.runInContext('(async v => ({__proto__: null, v: await v}))', ctx, {
      filename: 'lens:settle',
    }) as (p: unknown) => Promise<{ v: unknown }>
    const promise = script.runInContext(ctx, { timeout: opts.timeoutMs ?? LENS_SCRIPT_TIMEOUT_MS })
    const settled = await settle(promise)
    return { ok: true, meta: parsed.meta, value: settled.v }
  } catch (e) {
    return { ok: false, error: `Script execution error: ${e instanceof Error ? e.message : String(e)}` }
  }
}
