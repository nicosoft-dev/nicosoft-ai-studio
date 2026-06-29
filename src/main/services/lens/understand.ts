// Studio Lens — the UNDERSTAND reader: a content-pinned, TOOL-LESS one-shot summary (CC away_summary parity).
//
// CC summarizes with a one-shot, content-PINNED, tool-less fork (binary 2.1.186: querySource "away_summary" /
// "agent_summary" / "compact" all run maxTurns:1 with the source PINNED in and NO tools). An understand reader is
// exactly that shape — "summarize ONE known file" — so it reads the file in Node, PINS the content, and summarizes
// through the tool-less chat seam (LensDeps.runChat). With no Read / Grep / Glob / Bash it CANNOT traverse the
// dependency tree — which is what let a tool-armed, UNBOUNDED reader re-read the loop.ts hub ~486 turns (a 39-min
// runaway, observed in a dogfood). Note maxTurns:1 ALONE can't replace this: a tool-armed reader needs one turn to
// read and another to summarize; CC pins the content precisely so ONE turn suffices and no exploration is possible.
//
// This is NOT the review path — review finders keep tools + the pinned DIFF (Workflow code-review parity, the
// agent() spawner in agent-lens.ts). Carved out of agent-lens.ts so this load-bearing shape is UNIT-TESTABLE
// off-Electron (e2e/lens-understand.mts): it imports only contracts.ts (types + the card id) + node builtins.

import { readFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { readerCardId, type LensDeps } from './contracts'

// READER persona for understand mode. The file's full content is PINNED into the prompt (below), so — unlike the
// old tool-armed reader — this never tells the model to Read/Grep; it summarizes the provided text in one shot.
export const READER_SYSTEM =
  'You are an expert reader building a SHARED UNDERSTANDING of a codebase / document set. You are given ONE file ' +
  '(its full content is provided below). Produce a CONCISE, factual summary: what this file is, its key ' +
  'responsibilities and exported structures, any notable logic or invariants, and how it fits the larger system. ' +
  'This is for understanding only — NO judgment, NO pass/fail, NO recommendations. Keep it tight (a few short ' +
  'paragraphs at most).'

// Head-cap for the pinned file content. This is a DELIBERATE Studio value, NOT CC's Read cap: CC's Read tool caps
// a SHARED-CONTEXT read at 25_000 tokens (binary 2.1.186: `truncatedByTokenCap`). This reader is a dedicated,
// tool-less one-shot summarizer — the file is its whole job, in its own throwaway context — so it gets more
// headroom (120_000 chars ≈ 30k tokens) for a richer whole-file summary. The cap only guards against pinning a
// pathologically huge file; it cannot cause a loop (the reader has no tools). A file under it is pinned whole.
export const READER_MAX_PIN_CHARS = 120_000

// Read a target file's content for pinning. Returns null (not throw) on any failure — a missing / unreadable path
// just drops that reader; the map is assembled from whatever read OK.
export async function pinFileContent(path: string, cwd: string | undefined): Promise<string | null> {
  try {
    const raw = await readFile(resolvePath(cwd ?? process.cwd(), path), 'utf8')
    return raw.length <= READER_MAX_PIN_CHARS
      ? raw
      : raw.slice(0, READER_MAX_PIN_CHARS) + `\n\n[…truncated: file is ${raw.length} chars; summarize from the portion above.]`
  } catch {
    return null
  }
}

// The single user message handed to runChat: READER_SYSTEM folded in (runChat sends no system role) + the PINNED
// file content + an instruction to summarize ONLY from it (no exploration).
export function buildReaderPrompt(path: string, content: string): string {
  return `${READER_SYSTEM}\n\n=== ${path} ===\n${content}\n=== end of ${path} ===\n\nProduce your summary based ONLY on the content above.`
}

// Summarize ONE file as a content-pinned, tool-less chat call (the CC away_summary shape). Emits the same panel
// card events as the old reader (sub_tool_start → sub_tool_done) so the UI render is unchanged.
export async function readOne(deps: LensDeps, roleId: string, panelId: string, stepId: string, path: string, i: number, cwd?: string): Promise<{ path: string; summary: string } | null> {
  const toolId = readerCardId(i, stepId)
  deps.cb.onToolEvent?.(roleId, { type: 'sub_tool_start', toolUseId: toolId, parentToolId: panelId, name: 'Subject', input: { subject: path, phase: 'read', mode: 'understand' } })
  const content = await pinFileContent(path, cwd)
  if (content == null) {
    deps.cb.onToolEvent?.(roleId, { type: 'sub_tool_done', toolUseId: toolId, parentToolId: panelId, name: 'Subject', isError: true, result: `could not read ${path}` })
    return null
  }
  try {
    const summary = (await deps.runChat({ roleId, prompt: buildReaderPrompt(path, content) }))?.trim() ?? ''
    deps.cb.onToolEvent?.(roleId, { type: 'sub_tool_done', toolUseId: toolId, parentToolId: panelId, name: 'Subject', isError: false, input: { subject: path, phase: 'read', mode: 'understand', verdict: 'read', tokens: Math.round(content.length / 4) }, result: summary || '(no summary)' })
    return { path, summary }
  } catch (e) {
    deps.cb.onToolEvent?.(roleId, { type: 'sub_tool_done', toolUseId: toolId, parentToolId: panelId, name: 'Subject', isError: true, result: e instanceof Error ? e.message : String(e) })
    return null
  }
}
