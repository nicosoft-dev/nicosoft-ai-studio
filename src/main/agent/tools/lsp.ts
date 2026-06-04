// lsp tool (batch 4 / doc 25) — query a TypeScript/JavaScript language server for code intelligence the
// agent can't get from grep: where a symbol is defined, everywhere it's used, its inferred type/signature
// (hover), and the type errors in a file (diagnostics). Backed by ctx.lsp (LSPManager over typescript-
// language-server). Read-only + concurrency-safe — queries never mutate. Positions are 1-based.

import { z } from 'zod'
import { extname } from 'node:path'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'
import { confineReal } from '../confine'
import { LSP_EXTS, type LspLocation, type LspDiagnostic } from '../lsp/manager'

const inputSchema = z.strictObject({
  action: z.enum(['definition', 'references', 'hover', 'diagnostics']),
  file: z.string().describe('Path to a .ts/.tsx/.js/.jsx file (relative to cwd or absolute)'),
  line: z.number().int().min(1).optional().describe('1-based line — required for definition/references/hover'),
  col: z.number().int().min(1).optional().describe('1-based column — required for definition/references/hover'),
})

export const lspTool = buildTool({
  name: 'lsp',
  inputSchema,
  prompt: () =>
    'Query a TypeScript/JavaScript language server for code intelligence grep can\'t give you. Actions: ' +
    '"definition" (where the symbol at line:col is defined), "references" (everywhere it\'s used), "hover" ' +
    '(its inferred type / signature / doc at line:col), "diagnostics" (type + syntax errors in the file). ' +
    'line/col are 1-based and required for definition/references/hover. TS/JS files only. Use it to trace ' +
    'a symbol or check a file compiles, instead of guessing from text search.',
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  async call(input, ctx) {
    if (!ctx.lsp) throw new Error('The language server is not available in this context.')
    const file = await confineReal(ctx.cwd, input.file)
    if (!LSP_EXTS.has(extname(file))) {
      throw new Error(`lsp supports TS/JS files only (got "${extname(file) || 'no extension'}").`)
    }

    if (input.action === 'diagnostics') {
      return { data: formatDiagnostics(file, await ctx.lsp.diagnostics(file)) }
    }
    if (input.line == null || input.col == null) {
      throw new Error(`lsp "${input.action}" requires both line and col (1-based).`)
    }
    if (input.action === 'hover') {
      const text = await ctx.lsp.hover(file, input.line, input.col)
      return { data: text || '(no type information at that position)' }
    }
    const locs =
      input.action === 'definition'
        ? await ctx.lsp.definition(file, input.line, input.col)
        : await ctx.lsp.references(file, input.line, input.col)
    return { data: formatLocations(input.action, locs) }
  },
  mapResult(out, toolUseId): ToolResultBlock {
    return { type: 'tool_result', tool_use_id: toolUseId, content: out }
  },
})

function formatLocations(action: string, locs: LspLocation[]): string {
  if (!locs.length) return `No ${action} found at that position.`
  const lines = locs.map((l) => `${l.file}:${l.line}:${l.col}`)
  return `${locs.length} ${action} location${locs.length === 1 ? '' : 's'}:\n${lines.join('\n')}`
}

function formatDiagnostics(file: string, diags: LspDiagnostic[]): string {
  if (!diags.length) return `No diagnostics — ${file} has no type or syntax errors.`
  const lines = diags.map(
    (d) => `${d.severity} [${d.line}:${d.col}] ${d.message}${d.source ? ` (${d.source})` : ''}`
  )
  return `${diags.length} diagnostic${diags.length === 1 ? '' : 's'} in ${file}:\n${lines.join('\n')}`
}
