// WebSearch — delegate web search to an ISOLATED secondary request so the agent's main conversation never
// carries a server search tool (no multi-computer confusion). call() fires a fresh, single-purpose request
// whose only tool is the search, then hands the hits back as a normal tool_result. THREE backends, by protocol —
// each speaks the driver's OWN native protocol (studio never pushes a model onto another's entrypoint):
//   - anthropic: web_search_20250305 (standalone server search → web_search_tool_result). Pinned over the
//     newer web_search_20260209, which routes through the code_execution sandbox. Uses searchModel (Sonnet).
//   - gemini: google_search grounding — which 400s when combined with functionDeclarations, so it MUST be
//     isolated here (the agent loop always sends tools). See delegatedSearchGemini.
//   - openai: hosted web_search via an ISOLATED /v1/responses (delegatedSearchOpenAI). The MAIN agent loop
//     gives openai roles web_search as a serverTool (agent.service.run); this isolated path serves callers that
//     hand WebSearch as an EXPLICIT tool (e.g. /research runs on the lens seam, which injects no serverTools).

import { z } from 'zod'
import { geminiBase, geminiHeaders, geminiModelPath, openaiHeaders, trimBase } from '../../llm/_shared'
import { anthropicHeaders } from '../../llm/anthropic-wire'
import type { AgentLlmAccess } from '../context'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'

const inputSchema = z.object({
  query: z.string().min(2).describe('The search query'),
  allowed_domains: z.array(z.string()).optional().describe('Only include results from these domains'),
  blocked_domains: z.array(z.string()).optional().describe('Never include results from these domains'),
})

const WEB_SEARCH_TYPE = 'web_search_20250305' // standalone server search (returns web_search_tool_result directly)
const SEARCH_TIMEOUT_MS = 90_000
const MAX_USES = 5

interface SearchHit {
  title: string
  url: string
}
interface WebSearchOutput {
  query: string
  hits: SearchHit[]
  note?: string
}

interface MessagesResponse {
  content?: Array<{ type: string; content?: unknown }>
  usage?: { server_tool_use?: { web_search_requests?: number } }
}

function extractHits(content: NonNullable<MessagesResponse['content']>): SearchHit[] {
  const hits: SearchHit[] = []
  for (const block of content) {
    if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue
    for (const r of block.content as Array<Record<string, unknown>>) {
      if (r && typeof r === 'object' && typeof r.url === 'string') {
        hits.push({ title: typeof r.title === 'string' ? r.title : r.url, url: r.url })
      }
    }
  }
  return hits
}

async function delegatedSearch(
  llm: AgentLlmAccess,
  input: z.infer<typeof inputSchema>,
  signal: AbortSignal,
): Promise<WebSearchOutput> {
  const tool: Record<string, unknown> = { type: WEB_SEARCH_TYPE, name: 'web_search', max_uses: MAX_USES }
  if (input.allowed_domains?.length) tool.allowed_domains = input.allowed_domains
  if (input.blocked_domains?.length) tool.blocked_domains = input.blocked_domains

  const res = await fetch(`${trimBase(llm.baseUrl)}/v1/messages`, {
    method: 'POST',
    signal: AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]),
    headers: anthropicHeaders(llm.apiKey),
    body: JSON.stringify({
      model: llm.searchModel,
      max_tokens: 1024,
      system: 'You are an assistant for performing a web search tool use.',
      messages: [{ role: 'user', content: `Perform a web search for the query: ${input.query}` }],
      tools: [tool],
      stream: false,
    }),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`web search request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`)
  }
  const json = (await res.json()) as MessagesResponse
  const hits = extractHits(json.content ?? [])
  if (hits.length === 0) {
    const reqs = json.usage?.server_tool_use?.web_search_requests ?? 0
    return {
      query: input.query,
      hits: [],
      note:
        reqs === 0
          ? 'web search was not run (quota may be exhausted this turn — try again later)'
          : 'no results found',
    }
  }
  return { query: input.query, hits }
}

// Gemini's google_search grounding fires fine on its OWN but 400s when combined with functionDeclarations —
// and the agent loop always sends tools. So on a gemini context WebSearch issues an ISOLATED generateContent
// whose only tool is google_search (no function declarations), then harvests the grounding chunks as hits.
// Same isolation idea as the anthropic path, over Gemini's grounding response shape.
interface GeminiGroundingResponse {
  candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } }>
}
async function delegatedSearchGemini(
  llm: AgentLlmAccess,
  input: z.infer<typeof inputSchema>,
  signal: AbortSignal,
): Promise<WebSearchOutput> {
  const url = `${geminiBase(llm.baseUrl)}/v1beta/models/${geminiModelPath(llm.searchModel)}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]),
    headers: geminiHeaders(llm.apiKey),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `Search the web for: ${input.query}` }] }],
      tools: [{ google_search: {} }],
    }),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`web search request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`)
  }
  const json = (await res.json()) as GeminiGroundingResponse
  const seen = new Set<string>()
  const hits: SearchHit[] = []
  for (const chunk of json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    const uri = chunk.web?.uri
    if (uri && !seen.has(uri)) {
      seen.add(uri)
      hits.push({ title: chunk.web?.title ?? uri, url: uri })
    }
  }
  return hits.length ? { query: input.query, hits } : { query: input.query, hits: [], note: 'no results found' }
}

// OpenAI's hosted web_search (Responses API): an ISOLATED /v1/responses whose only tool is web_search, then
// harvest the source URLs. Unlike anthropic's web_search_tool_result (a structured hit list), OpenAI's hosted
// search is AGENT-STYLE — the model searches, opens pages, and writes an answer — so the sources surface three
// ways and we UNION them: url_citation annotations (when the model cites), the web_search_call open_page URLs
// (pages the model actually opened), and any URLs in the answer text (fallback). A reasoning model needs real
// output room, so max_output_tokens is generous (a `1` cap would starve it before it ever searched).
interface ResponsesSearchOutput {
  output?: Array<{
    type: string
    action?: { type?: string; url?: string }
    content?: Array<{ text?: string; annotations?: Array<{ type?: string; url?: string; title?: string }> }>
  }>
}
async function delegatedSearchOpenAI(
  llm: AgentLlmAccess,
  input: z.infer<typeof inputSchema>,
  signal: AbortSignal,
): Promise<WebSearchOutput> {
  const res = await fetch(`${trimBase(llm.baseUrl)}/v1/responses`, {
    method: 'POST',
    signal: AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]),
    headers: openaiHeaders(llm.apiKey),
    body: JSON.stringify({
      model: llm.searchModel,
      instructions: 'You are a web-search assistant. Search the web for the query and report the most relevant result URLs with their titles.',
      input: [{ role: 'user', content: [{ type: 'input_text', text: `Perform a web search for the query: ${input.query}` }] }],
      tools: [{ type: 'web_search' }],
      store: false,
      max_output_tokens: 8192,
    }),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`web search request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`)
  }
  const json = (await res.json()) as ResponsesSearchOutput
  const hits: SearchHit[] = []
  const seen = new Set<string>()
  const add = (url: string, title?: string): void => {
    const clean = url.replace(/[.,;]+$/, '')
    if (!clean || seen.has(clean)) return
    seen.add(clean)
    hits.push({ title: title || clean, url: clean })
  }
  for (const item of json.output ?? []) {
    if (item.type === 'web_search_call' && item.action?.type === 'open_page' && item.action.url) add(item.action.url)
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        for (const a of part.annotations ?? []) if (a.type === 'url_citation' && a.url) add(a.url, a.title)
        for (const m of (part.text ?? '').matchAll(/https?:\/\/[^\s)\]<>"']+/g)) add(m[0])
      }
    }
  }
  return hits.length ? { query: input.query, hits } : { query: input.query, hits: [], note: 'no results found' }
}

const DESCRIPTION = `- Searches the web for current information and returns matching result links (title + URL).
- Input: a search query, optionally scoped with allowed_domains or blocked_domains.
- Read-only. After using results, cite the source URLs in your answer.
- To fetch and read a specific page's full content, use WebFetch instead.
- Search for things that genuinely change — prices, policies, versions, schedules, who-holds-what-role, recent events — NOT for stable facts or facts that live in the user's own files/project (read those instead).
- For the user's PRIVATE workspace data (their repos, issues, calendar, email, docs, analytics), prefer a connected / MCP tool over web search. If that connector isn't available, say what access is missing — do not substitute public web results for the user's private data.`

export const webSearchTool = buildTool<typeof inputSchema, WebSearchOutput>({
  name: 'WebSearch',
  inputSchema,
  prompt: () => DESCRIPTION,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  maxResultSizeChars: 50_000,
  async validateInput(input) {
    if (input.allowed_domains?.length && input.blocked_domains?.length) {
      return { result: false, message: 'Specify only one of allowed_domains or blocked_domains' }
    }
    return { result: true }
  },
  async call(input, ctx) {
    if (!ctx.llm) throw new Error('WebSearch requires an LLM-enabled context (ctx.llm is unset)')
    const out =
      ctx.llm.protocol === 'gemini'
        ? await delegatedSearchGemini(ctx.llm, input, ctx.signal)
        : ctx.llm.protocol === 'openai'
          ? await delegatedSearchOpenAI(ctx.llm, input, ctx.signal)
          : await delegatedSearch(ctx.llm, input, ctx.signal)
    return { data: out }
  },
  mapResult(out, toolUseId): ToolResultBlock {
    if (out.hits.length === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: `No web results for "${out.query}".${out.note ? ` (${out.note})` : ''}`,
      }
    }
    const lines = out.hits.map((h) => `- [${h.title}](${h.url})`).join('\n')
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: `Web search results for "${out.query}":\n\n${lines}\n\nCite the source URLs you use in your answer.`,
    }
  },
})
