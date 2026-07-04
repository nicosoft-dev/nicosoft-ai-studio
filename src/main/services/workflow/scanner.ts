// Workflow security scanner — the §5.1 AST ALLOW-LIST static scan, run on IMPORT and SAVE alike (one
// entry, no source distinction). Parse, never execute. Anything not explicitly allowed is a violation
// with its line number, so the import dialog / editor lint can point at it.
//
// Parser: acorn — deliberately the SAME parser the script executor uses (services/script/executor
// parseScript/transpile), not the TypeScript compiler API. Two reasons, both root-cause: ① typescript is
// a devDependency only (bundling the ~8MB compiler into the main process for a scanner is dead weight);
// ② scanner-parser ≠ executor-parser is a classic bypass class (code the scanner reads one way and the
// engine executes another). One parser = the scanner judges exactly the AST the engine will run.
//
// Threat model: a .nsw file is UNTRUSTED INPUT. node:vm is not a security boundary (executor header), so
// this layer rejects the known escape PRIMITIVES at the syntax level — dynamic code generation, prototype
// chain walking, host identifiers, generator machinery — before a script can ever reach the sandbox.
// Layer ② is the hardened sandbox itself; layer ③ is exception management + the enabled=0 human gate.

import { parse, type Node } from 'acorn'
import { parseScript } from '../script/executor'
import type { WorkflowScanDto } from '../../ipc/contracts'

type Ast = Node & { [k: string]: unknown }

// The .nsw format version this build understands. meta.nsw greater than this → reject (newer format).
export const NSW_VERSION = 1

// ── allow/deny tables ───────────────────────────────────────────────────────────────────────────────────

// Identifier names that mean host escape wherever they are REFERENCED (not as a plain `.prop` name).
const HOST_IDENTIFIERS = new Set([
  'process', 'globalThis', 'global', 'window', 'self', 'Reflect', 'Proxy', 'Buffer', 'WebAssembly',
  'require', 'module', 'exports', 'import', 'eval', 'Function', 'AsyncFunction', 'GeneratorFunction',
  'queueMicrotask', 'setTimeout', 'setInterval', 'setImmediate', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'SharedArrayBuffer', 'Atomics', 'FinalizationRegistry', 'WeakRef',
])

// Property names whose ACCESS is prototype-chain walking, however written (.p / ['p'] / computed).
const PROTO_PROPS = new Set(['__proto__', 'prototype', 'constructor'])

// Bare-call whitelist: the orchestration primitives + pure conversions. Script-declared functions are
// additionally allowed (collected in a first pass).
const CALL_GLOBALS = new Set([
  'agent', 'parallel', 'pipeline', 'phase', 'log',
  'String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
])

// <Global>.<method> whitelist — the pure-data namespaces. Math.* is whitelisted wholesale (Math.random is
// already unavailable in the sandbox; determinism, not escape). Everything else is name-by-name.
const NAMESPACE_METHODS: Record<string, Set<string> | 'all'> = {
  JSON: new Set(['parse', 'stringify']),
  Math: 'all',
  Object: new Set(['keys', 'values', 'entries', 'fromEntries', 'assign', 'freeze']),
  Array: new Set(['from', 'isArray', 'of']),
  Number: new Set(['isInteger', 'isFinite', 'isNaN', 'parseFloat', 'parseInt']),
  String: new Set(['fromCharCode', 'fromCodePoint']),
  Promise: new Set(['resolve', 'reject', 'all', 'allSettled']),
  Date: new Set(['parse', 'UTC']),
}

// Method-call whitelist on ANY receiver — the side-effect-free (in-realm) data methods of Array / String /
// Number / RegExp / Set / Map / Promise. Mutating array methods (push/sort/…) stay allowed: they mutate
// vm-realm data the script owns, not the host.
const PURE_METHODS = new Set([
  // array
  'map', 'filter', 'reduce', 'reduceRight', 'forEach', 'find', 'findIndex', 'findLast', 'findLastIndex',
  'flat', 'flatMap', 'slice', 'splice', 'concat', 'join', 'includes', 'indexOf', 'lastIndexOf', 'push',
  'pop', 'shift', 'unshift', 'sort', 'reverse', 'some', 'every', 'keys', 'values', 'entries', 'fill', 'at',
  // string
  'trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase', 'split', 'replace', 'replaceAll',
  'startsWith', 'endsWith', 'padStart', 'padEnd', 'repeat', 'charAt', 'charCodeAt', 'codePointAt',
  'substring', 'match', 'matchAll', 'search', 'localeCompare', 'normalize',
  // number / generic value
  'toFixed', 'toPrecision', 'toString', 'valueOf',
  // regexp
  'test', 'exec',
  // set / map
  'add', 'has', 'get', 'set', 'delete', 'clear',
  // promise
  'then', 'catch', 'finally',
])

// Constructable built-ins. `new Date(ts)` needs an argument (the sandbox shim throws on zero-arg anyway;
// rejecting it statically gives a line number instead of a runtime throw).
const NEW_WHITELIST = new Set(['Date', 'Set', 'Map', 'RegExp', 'Error', 'Array'])

// Statement/expression node types allowed as-is (their CHILDREN are still walked). Everything not listed
// here and not special-cased in scanNode below is a violation — that is what makes this an allow-list.
const ALLOWED_NODES = new Set([
  'Program', 'ExpressionStatement', 'VariableDeclaration', 'VariableDeclarator', 'FunctionDeclaration',
  'FunctionExpression', 'ArrowFunctionExpression', 'BlockStatement', 'ReturnStatement', 'IfStatement',
  'ForOfStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement', 'BreakStatement',
  'ContinueStatement', 'LabeledStatement', 'SwitchStatement', 'SwitchCase', 'ThrowStatement',
  'TryStatement', 'CatchClause', 'AwaitExpression', 'BinaryExpression', 'LogicalExpression',
  'UnaryExpression', 'UpdateExpression', 'ConditionalExpression', 'AssignmentExpression',
  'SequenceExpression', 'ArrayExpression', 'ObjectExpression', 'Property', 'SpreadElement',
  'RestElement', 'ObjectPattern', 'ArrayPattern', 'AssignmentPattern', 'TemplateLiteral',
  'TemplateElement', 'Literal', 'Identifier', 'ChainExpression', 'EmptyStatement',
  // CallExpression / NewExpression / MemberExpression / meta export are special-cased, not blanket-allowed
])

// ── result plumbing ─────────────────────────────────────────────────────────────────────────────────────

type Category = 'dynamicCode' | 'prototypeAccess' | 'hostIdentifiers' | 'allowListedCalls'

interface Violation {
  line: number
  message: string
  category: Category
}

// Parse the FULL script as a module with positions — shared with analyze.ts so lint line numbers and scan
// line numbers come from the same parse configuration.
export function parseFull(src: string): { ast: Ast } | { error: string } {
  try {
    return {
      ast: parse(src, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
        locations: true,
      }) as unknown as Ast,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

const lineOf = (n: Ast): number => ((n.loc as { start?: { line?: number } } | undefined)?.start?.line ?? 1)

// ── the scan ────────────────────────────────────────────────────────────────────────────────────────────

// Scan a full workflow script (meta included). Returns the four-card verdict + per-line violations.
// A script that does not PARSE cannot be scanned — callers gate on parse first (WorkflowLintDto.scan=null).
export function scan(src: string): WorkflowScanDto {
  const violations: Violation[] = []
  const parsed = parseFull(src)
  if ('error' in parsed) {
    return {
      ok: false,
      violations: [{ line: 1, message: `not scannable: ${parsed.error}` }],
      checks: { dynamicCode: false, prototypeAccess: false, hostIdentifiers: false, allowListedCalls: false },
    }
  }
  const body = parsed.ast.body as Ast[]

  // meta discipline: parseScript enforces first-statement + pure literal + name/description; the scanner
  // adds the .nsw format anchor on top (missing / newer-than-supported → reject). Empty description is
  // legal for a workflow ('' → the list shows the role chain) — only lens/skill scripts require it.
  const meta = parseScript(src, { allowEmptyDescription: true })
  if ('error' in meta) {
    violations.push({ line: 1, message: meta.error, category: 'allowListedCalls' })
  } else {
    const nsw = meta.meta.nsw
    if (typeof nsw !== 'number' || !Number.isInteger(nsw)) {
      violations.push({ line: 1, message: 'meta.nsw (format version) is required — add `nsw: 1` to meta', category: 'allowListedCalls' })
    } else if (nsw > NSW_VERSION) {
      violations.push({ line: 1, message: `meta.nsw ${nsw} is newer than this build supports (${NSW_VERSION}) — update the app to import it`, category: 'allowListedCalls' })
    }
  }

  // First pass: collect script-declared function/variable names — calling YOUR OWN helper is allowed.
  const declared = new Set<string>()
  collectDeclared(body, declared)

  // Second pass: allow-list walk. Statement 0 (the meta export) is validated above by parseScript — skip
  // its subtree here (it is a pure literal by construction; ExportNamedDeclaration is otherwise rejected).
  for (let i = 0; i < body.length; i++) {
    const stmt = body[i]
    if (i === 0 && stmt.type === 'ExportNamedDeclaration') continue
    scanNode(stmt, violations, declared)
  }

  const bad = (c: Category): boolean => violations.some((v) => v.category === c)
  return {
    ok: violations.length === 0,
    violations: violations.map(({ line, message }) => ({ line, message })),
    checks: {
      dynamicCode: !bad('dynamicCode'),
      prototypeAccess: !bad('prototypeAccess'),
      hostIdentifiers: !bad('hostIdentifiers'),
      allowListedCalls: !bad('allowListedCalls'),
    },
  }
}

function collectDeclared(nodes: Ast[], out: Set<string>): void {
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue
    if (n.type === 'FunctionDeclaration') {
      const id = n.id as Ast | null
      if (id?.type === 'Identifier') out.add(id.name as string)
    }
    if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations as Ast[]) {
        const id = d.id as Ast
        if (id?.type === 'Identifier') out.add(id.name as string)
        // destructured bindings: collect pattern identifiers so `const { a, b } = x; a(...)` stays callable
        else collectPattern(id, out)
      }
    }
  }
}

function collectPattern(p: Ast, out: Set<string>): void {
  if (!p || typeof p !== 'object') return
  if (p.type === 'Identifier') { out.add(p.name as string); return }
  if (p.type === 'ObjectPattern') for (const prop of p.properties as Ast[]) collectPattern((prop.value ?? prop.argument) as Ast, out)
  if (p.type === 'ArrayPattern') for (const el of (p.elements as (Ast | null)[])) if (el) collectPattern(el, out)
  if (p.type === 'AssignmentPattern') collectPattern(p.left as Ast, out)
  if (p.type === 'RestElement') collectPattern(p.argument as Ast, out)
}

// Push a violation.
function v(out: Violation[], node: Ast, category: Category, message: string): void {
  out.push({ line: lineOf(node), message, category })
}

// The recursive allow-list check. `propertyName` positions (non-computed member .prop, object keys) are
// NOT identifier references — they get the prototype-props check only.
function scanNode(node: Ast | null, out: Violation[], declared: Set<string>): void {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return

  switch (node.type) {
    // ── hard rejects, most specific message first ──────────────────────────────────────────────────────
    case 'ImportExpression':
      v(out, node, 'dynamicCode', 'dynamic import() is not allowed in workflow scripts')
      return
    case 'ImportDeclaration':
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
    case 'ExportAllDeclaration':
      v(out, node, 'allowListedCalls', 'import/export statements are not allowed in the script body (only the leading `export const meta`)')
      return
    case 'ClassDeclaration':
    case 'ClassExpression':
      v(out, node, 'prototypeAccess', 'class syntax is not allowed (prototype machinery)')
      return
    case 'ThisExpression':
      v(out, node, 'hostIdentifiers', '`this` is not allowed in workflow scripts')
      return
    case 'MetaProperty': // import.meta / new.target
      v(out, node, 'hostIdentifiers', `${'meta' in node ? 'import.meta / new.target' : 'meta property'} is not allowed`)
      return
    case 'TaggedTemplateExpression':
      v(out, node, 'allowListedCalls', 'tagged template calls are not allowed')
      return
    case 'ForInStatement':
      v(out, node, 'prototypeAccess', 'for-in enumerates the prototype chain — use for-of / Object.keys() instead')
      return
    case 'YieldExpression':
      v(out, node, 'allowListedCalls', 'generators are not allowed in workflow scripts')
      return

    case 'Identifier': {
      // a REFERENCE to a host identifier (property-name positions never reach here — see the member/property cases)
      const name = node.name as string
      if (HOST_IDENTIFIERS.has(name)) v(out, node, 'hostIdentifiers', `\`${name}\` is not allowed in workflow scripts`)
      if (PROTO_PROPS.has(name)) v(out, node, 'prototypeAccess', `\`${name}\` is not allowed in workflow scripts`)
      return
    }

    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      if (node.generator === true) {
        v(out, node, 'allowListedCalls', 'generators (function*) are not allowed in workflow scripts')
        return
      }
      for (const p of (node.params as Ast[]) ?? []) collectPattern(p, declared) // params are callable bindings
      scanNode(node.body as Ast, out, declared)
      return
    }

    case 'MemberExpression': {
      scanMember(node, out, declared)
      return
    }

    case 'CallExpression': {
      scanCall(node, out, declared)
      return
    }

    case 'NewExpression': {
      const callee = node.callee as Ast
      const cname = callee.type === 'Identifier' ? (callee.name as string) : ''
      if (cname === 'Function' || cname === 'AsyncFunction' || cname === 'GeneratorFunction') {
        v(out, node, 'dynamicCode', `\`new ${cname}\` is dynamic code generation — not allowed`)
      } else if (cname && HOST_IDENTIFIERS.has(cname)) {
        v(out, node, 'hostIdentifiers', `\`new ${cname}\` is not allowed in workflow scripts`)
      } else if (callee.type !== 'Identifier' || !NEW_WHITELIST.has(callee.name as string)) {
        v(out, node, 'allowListedCalls', `\`new ${callee.type === 'Identifier' ? callee.name : '<expression>'}\` is not allowed — only new ${[...NEW_WHITELIST].join('/')}`)
      } else if (callee.name === 'Date' && (node.arguments as Ast[]).length === 0) {
        v(out, node, 'allowListedCalls', 'zero-arg `new Date()` is non-deterministic — use args.runAt')
      }
      for (const a of node.arguments as Ast[]) scanNode(a, out, declared)
      return
    }

    case 'Property': {
      // object literal / pattern property: computed keys are rejected (dynamic key = pollution vector),
      // the KEY name itself is checked against proto props, the VALUE is walked as a normal node.
      if (node.computed === true) {
        v(out, node, 'prototypeAccess', 'computed object keys are not allowed — use a literal key')
      } else {
        const key = node.key as Ast
        const name = key.type === 'Identifier' ? (key.name as string) : key.type === 'Literal' ? String(key.value) : ''
        if (PROTO_PROPS.has(name)) v(out, node, 'prototypeAccess', `object key \`${name}\` is not allowed`)
      }
      scanNode(node.value as Ast, out, declared)
      return
    }
  }

  // Generic allow-listed node: walk every child. Unknown node type → violation (the allow-list teeth).
  if (!ALLOWED_NODES.has(node.type)) {
    v(out, node, 'allowListedCalls', `\`${node.type}\` syntax is not allowed in workflow scripts`)
    return
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'type') continue
    const child = node[key]
    if (Array.isArray(child)) for (const c of child) scanNode(c as Ast, out, declared)
    else if (child && typeof child === 'object' && 'type' in (child as object)) scanNode(child as Ast, out, declared)
  }
}

// Member access rules: `.prop` → prop name checked against PROTO_PROPS (a plain name like `.length` is
// fine and NOT an identifier reference); computed `obj[x]` → x must be a NON-NEGATIVE INTEGER LITERAL
// (`obj['cons'+'tructor']`-style dynamic building cannot be proven pure → rejected; use .at(i) / a Map
// for variable indexing). The OBJECT side is walked as a normal node.
function scanMember(node: Ast, out: Violation[], declared: Set<string>): void {
  const prop = node.property as Ast
  if (node.computed === true) {
    const isIntLiteral = prop.type === 'Literal' && typeof prop.value === 'number' && Number.isInteger(prop.value) && prop.value >= 0
    if (!isIntLiteral) {
      const isStringProto = prop.type === 'Literal' && PROTO_PROPS.has(String(prop.value))
      v(
        out, node,
        'prototypeAccess',
        isStringProto
          ? `\`['${String((prop as { value?: unknown }).value)}']\` is prototype-chain access`
          : 'computed property access needs a non-negative integer literal index — use .at(i) or a Map for dynamic keys',
      )
    }
  } else {
    const name = prop.type === 'Identifier' ? (prop.name as string) : ''
    if (PROTO_PROPS.has(name)) v(out, node, 'prototypeAccess', `\`.${name}\` is prototype-chain access`)
    if (name === '__defineGetter__' || name === '__defineSetter__' || name === '__lookupGetter__' || name === '__lookupSetter__') {
      v(out, node, 'prototypeAccess', `\`.${name}\` is not allowed`)
    }
  }
  scanNode(node.object as Ast, out, declared)
}

// Call rules — the §5.1 call surface: primitives + whitelisted pure-data methods + the script's own
// helpers. Everything else is rejected by NAME with the line.
function scanCall(node: Ast, out: Violation[], declared: Set<string>): void {
  const callee = node.callee as Ast

  if (callee.type === 'Identifier') {
    const name = callee.name as string
    if (name === 'eval' || name === 'Function') {
      v(out, node, 'dynamicCode', `\`${name}()\` is dynamic code generation — not allowed`)
    } else if (name === 'require') {
      v(out, node, 'dynamicCode', '`require()` is not allowed in workflow scripts')
    } else if (HOST_IDENTIFIERS.has(name)) {
      v(out, node, 'hostIdentifiers', `\`${name}\` is not allowed in workflow scripts`)
    } else if (!CALL_GLOBALS.has(name) && !declared.has(name)) {
      v(out, node, 'allowListedCalls', `\`${name}()\` is not an allowed call — allowed: agent/parallel/pipeline/phase/log, pure data methods, and functions this script declares`)
    }
  } else if (callee.type === 'MemberExpression' || (callee.type === 'ChainExpression' && (callee.expression as Ast).type === 'MemberExpression')) {
    const member = callee.type === 'ChainExpression' ? (callee.expression as Ast) : callee
    const obj = member.object as Ast
    const prop = member.property as Ast
    const methodName = member.computed !== true && prop.type === 'Identifier' ? (prop.name as string) : null
    if (methodName === null) {
      v(out, node, 'prototypeAccess', 'computed method calls (obj[expr]()) are not allowed')
    } else if (obj.type === 'Identifier' && obj.name === 'Object' && !((NAMESPACE_METHODS.Object as Set<string>).has(methodName))) {
      // Object.create/defineProperty/getPrototypeOf/setPrototypeOf/… are prototype machinery, called out explicitly
      v(out, node, 'prototypeAccess', `\`Object.${methodName}()\` is not allowed — allowed: ${[...(NAMESPACE_METHODS.Object as Set<string>)].join('/')}`)
    } else if (obj.type === 'Identifier' && Object.prototype.hasOwnProperty.call(NAMESPACE_METHODS, obj.name as string)) {
      const allowed = NAMESPACE_METHODS[obj.name as string]
      if (allowed !== 'all' && !allowed.has(methodName)) {
        v(out, node, 'allowListedCalls', `\`${obj.name}.${methodName}()\` is not an allowed call`)
      }
    } else if (!PURE_METHODS.has(methodName)) {
      v(out, node, 'allowListedCalls', `\`.${methodName}()\` is not an allow-listed data method`)
    }
    // walk the receiver chain (its own member rules apply) + skip re-walking the property name
    scanNode(obj, out, declared)
  } else {
    // IIFE-style ((…) => …)() and other exotic callee shapes: allow plain function-expression IIFEs,
    // reject the rest (an eval-adjacent surface with no orchestration use case).
    if (callee.type === 'ArrowFunctionExpression' || callee.type === 'FunctionExpression') {
      scanNode(callee, out, declared)
    } else {
      v(out, node, 'allowListedCalls', `calling a \`${callee.type}\` is not allowed`)
    }
  }
  for (const a of node.arguments as Ast[]) scanNode(a, out, declared)
}
