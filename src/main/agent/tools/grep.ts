// Grep tool — search file contents for a regex across the project. Read-only + safe. Enumerates
// candidate files via glob, confines each resolved path (drops symlink escapes), size-gates BEFORE
// reading, then matches in-process (no shell), skipping binary files.

import { glob, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { semanticBoolean, semanticNumber } from './semantic'
import { confineReal } from '../confine'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'

const inputSchema = z.object({
  pattern: z.string().describe('Regular expression to search file contents for'),
  path: z.string().optional().describe('Directory or file to scope the search to (default: whole project)'),
  glob: z.string().optional().describe('File glob to limit the search (e.g. "*.ts", "src/**/*.tsx"). Default **/*'),
  output_mode: z
    .enum(['content', 'files_with_matches', 'count'])
    .optional()
    .describe('content = file:line:text (honors -A/-B/-C + -n); files_with_matches = unique file paths; count = per-file match counts. Default: content.'),
  ignore_case: semanticBoolean(z.boolean().optional()).describe('Case-insensitive match'),
  '-i': semanticBoolean(z.boolean().optional()).describe('Alias for ignore_case'),
  '-n': semanticBoolean(z.boolean().optional()).describe('Show line numbers in content mode (default true)'),
  '-A': semanticNumber(z.number().int().min(0).optional()).describe('Lines of context AFTER each match (content mode)'),
  '-B': semanticNumber(z.number().int().min(0).optional()).describe('Lines of context BEFORE each match (content mode)'),
  '-C': semanticNumber(z.number().int().min(0).optional()).describe('Lines of context before AND after each match (content mode)'),
  head_limit: semanticNumber(z.number().int().min(0).optional()).describe('Cap on the number of results (default + hard max 200)'),
})

const MAX_MATCHES = 200
const MAX_FILE_BYTES = 1024 * 1024

export const grepTool = buildTool<typeof inputSchema, string>({
  name: 'Grep',
  inputSchema,
  prompt: () =>
    'Search file contents across the project for a regular expression. Returns file:line:text matches.',
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  maxResultSizeChars: 20_000,
  validateInput: async (input) => {
    if ((input.glob ?? '').includes('..')) {
      return { result: false, message: 'glob must not contain ".." — searches stay within the project.' }
    }
    try {
      new RegExp(input.pattern)
      return { result: true }
    } catch (err) {
      return { result: false, message: `Invalid regex: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
  async call(input, ctx) {
    const ignoreCase = input.ignore_case ?? input['-i'] ?? false
    const re = new RegExp(input.pattern, ignoreCase ? 'i' : '')
    const mode = input.output_mode ?? 'content'
    const before = input['-B'] ?? input['-C'] ?? 0
    const after = input['-A'] ?? input['-C'] ?? 0
    const showLineNo = input['-n'] ?? true
    const limit = input.head_limit && input.head_limit > 0 ? Math.min(input.head_limit, MAX_MATCHES) : MAX_MATCHES
    // Scope to `path` by prefixing the file glob, so matches stay relative to the project root.
    const base = input.glob ?? '**/*'
    const filePattern = input.path ? join(input.path.replace(/\/+$/, ''), base) : base
    const contentLines: string[] = []
    const fileSet: string[] = []
    const counts: string[] = []
    let emitted = 0
    outer: for await (const entry of glob(filePattern, { cwd: ctx.cwd })) {
      const rel = entry as string
      let abs: string
      try {
        abs = await confineReal(ctx.cwd, rel) // drop symlink-escaping / absolute matches
      } catch {
        continue
      }
      const st = await stat(abs).catch(() => null)
      if (!st || !st.isFile() || st.size > MAX_FILE_BYTES) continue // size-gate BEFORE reading
      let content: string
      try {
        content = await readFile(abs, 'utf-8')
      } catch {
        continue
      }
      if (content.includes('\0')) continue // binary
      const lines = content.split('\n')
      let fileMatches = 0
      const emittedCtx = new Set<number>() // dedup overlapping context windows within a file
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue
        fileMatches++
        if (mode === 'content') {
          for (let c = Math.max(0, i - before); c <= Math.min(lines.length - 1, i + after); c++) {
            if (emittedCtx.has(c)) continue
            emittedCtx.add(c)
            contentLines.push(`${rel}:${showLineNo ? `${c + 1}:` : ''}${lines[c].slice(0, 300)}`)
          }
          if (++emitted >= limit) break outer
        }
      }
      if (fileMatches > 0 && mode === 'files_with_matches') {
        fileSet.push(rel)
        if (++emitted >= limit) break
      } else if (fileMatches > 0 && mode === 'count') {
        counts.push(`${rel}:${fileMatches}`)
        if (++emitted >= limit) break
      }
    }
    if (mode === 'files_with_matches') return { data: fileSet.join('\n') }
    if (mode === 'count') return { data: counts.join('\n') }
    return { data: contentLines.join('\n') }
  },
  mapResult(out, toolUseId): ToolResultBlock {
    return { type: 'tool_result', tool_use_id: toolUseId, content: out || '(no matches)' }
  },
})
