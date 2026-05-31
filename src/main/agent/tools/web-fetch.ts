// WebFetch — fetch a URL and extract what the prompt asks for, using a small fast model. Mirrors
// ccb's WebFetchTool pattern: fetch → HTML→markdown (turndown) → truncate → run the prompt over the
// content with a cheap model, return its answer. Read-only (modifies nothing), concurrency-safe.
//
// Differences from ccb (adapted to studio's stack): Node fetch instead of axios; our own SSRF guard
// (checkUrlSsrf) instead of Anthropic's domain_info preflight; the small-model call goes through
// chatAnthropic against ctx.llm. Same-host(±www) redirects are followed; a cross-host redirect is
// reported back so the model re-issues WebFetch with the new URL (an open-redirect can't silently
// bounce us to another origin).

import TurndownService from 'turndown'
import { z } from 'zod'
import { chatAnthropic } from '../../llm/anthropic'
import type { AgentLlmAccess } from '../context'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'
import { checkUrlSsrf } from './ssrf'

const inputSchema = z.object({
  url: z.string().url().describe('The URL to fetch (http upgraded to https)'),
  prompt: z.string().describe('What information to extract from the page'),
})

const MAX_MARKDOWN = 100_000 // cap chars fed to the extraction model
const MAX_CONTENT_BYTES = 10 * 1024 * 1024 // 10MB hard cap on the fetched body
const FETCH_TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 10

// Lazy turndown singleton — constructing it builds ~15 rule objects; turndown() itself is stateless.
let turndown: TurndownService | undefined
function htmlToMarkdown(html: string): string {
  turndown ??= new TurndownService()
  return turndown.turndown(html)
}

// A redirect is safe to follow only within the same host (± a www. prefix) and same scheme/port —
// anything else is reported to the model instead, so an open redirect can't bounce us cross-origin.
function isSameHostRedirect(from: string, to: string): boolean {
  try {
    const a = new URL(from)
    const b = new URL(to)
    if (a.protocol !== b.protocol || a.port !== b.port) return false
    if (b.username || b.password) return false
    const strip = (h: string): string => h.replace(/^www\./, '')
    return strip(a.hostname) === strip(b.hostname)
  } catch {
    return false
  }
}

type FetchOutcome =
  | { kind: 'content'; markdown: string; contentType: string }
  | { kind: 'redirect'; redirectUrl: string }

async function fetchPage(rawUrl: string, signal: AbortSignal, depth = 0): Promise<FetchOutcome> {
  if (depth > MAX_REDIRECTS) throw new Error(`too many redirects (exceeded ${MAX_REDIRECTS})`)
  // Upgrade http → https before connecting.
  const u = new URL(rawUrl)
  if (u.protocol === 'http:') u.protocol = 'https:'
  const target = u.toString()

  const res = await fetch(target, {
    redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
    headers: { Accept: 'text/markdown, text/html, */*', 'User-Agent': 'NicoSoft-AI-Studio/WebFetch' },
  })

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location')
    if (!loc) throw new Error('redirect response missing Location header')
    const redirectUrl = new URL(loc, target).toString()
    if (isSameHostRedirect(target, redirectUrl)) {
      const blocked = await checkUrlSsrf(redirectUrl) // re-guard the redirect target
      if (blocked) throw new Error(`redirect blocked: ${blocked}`)
      return fetchPage(redirectUrl, signal, depth + 1)
    }
    return { kind: 'redirect', redirectUrl }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

  const contentType = res.headers.get('content-type') ?? ''
  const body = await readCapped(res, MAX_CONTENT_BYTES)
  const text = body.toString('utf-8')
  const markdown = contentType.includes('text/html') ? htmlToMarkdown(text) : text
  return { kind: 'content', markdown, contentType }
}

// Read the body stream up to `cap` bytes, then cancel — prevents a huge/streaming response from
// exhausting memory (fetch's arrayBuffer() has no size limit).
async function readCapped(res: Response, cap: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value && value.length > 0) {
      chunks.push(Buffer.from(value))
      total += value.length
      if (total >= cap) {
        await reader.cancel()
        break
      }
    }
  }
  return Buffer.concat(chunks).subarray(0, cap)
}

// Run the user's extraction prompt over the page content with the small model. Copyright guardrails
// match our system policy: short quoted excerpts only, no song lyrics.
async function extractWithModel(
  llm: AgentLlmAccess,
  markdown: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const content =
    markdown.length > MAX_MARKDOWN ? markdown.slice(0, MAX_MARKDOWN) + '\n\n[content truncated to fit]' : markdown
  const userPrompt = `Web page content:\n---\n${content}\n---\n\n${prompt}\n\nProvide a concise response based only on the content above. Quote at most 125 characters from any source, in quotation marks with attribution; never reproduce song lyrics.`
  const result = await chatAnthropic(
    {
      protocol: 'anthropic',
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.smallModel,
      messages: [{ role: 'user', content: userPrompt }],
      signal,
    },
    () => {},
  )
  return result.text || '(the model returned no content)'
}

interface WebFetchOutput {
  result: string
  url: string
}

const DESCRIPTION = `- Fetches a URL and extracts information from it using a small, fast model.
- Input: a URL and a prompt describing what to extract from the page.
- Fetches the page, converts HTML to markdown, runs the prompt over the content, returns the answer.
- HTTP URLs are upgraded to HTTPS. This tool is read-only and modifies nothing.
- When a URL redirects to a different host, the tool reports the redirect URL; re-issue WebFetch with that URL.
- For GitHub URLs, prefer the gh CLI via Bash (gh pr view / gh issue view / gh api) when you can.`

export const webFetchTool = buildTool<typeof inputSchema, WebFetchOutput>({
  name: 'WebFetch',
  inputSchema,
  prompt: () => DESCRIPTION,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  isDestructive: () => false,
  maxResultSizeChars: 100_000,
  async validateInput(input) {
    try {
      new URL(input.url)
      return { result: true }
    } catch {
      return { result: false, message: `Invalid URL: ${input.url}` }
    }
  },
  async call(input, ctx) {
    if (!ctx.llm) throw new Error('WebFetch requires an LLM-enabled context (ctx.llm is unset)')
    const blocked = await checkUrlSsrf(input.url)
    if (blocked) throw new Error(`WebFetch blocked: ${blocked}`)

    const outcome = await fetchPage(input.url, ctx.signal)
    if (outcome.kind === 'redirect') {
      return {
        data: {
          url: input.url,
          result: `REDIRECT: ${input.url} redirects to a different host: ${outcome.redirectUrl}\nRe-issue WebFetch with url: "${outcome.redirectUrl}" to fetch the content.`,
        },
      }
    }
    const result = await extractWithModel(ctx.llm, outcome.markdown, input.prompt, ctx.signal)
    return { data: { url: input.url, result } }
  },
  mapResult(out, toolUseId): ToolResultBlock {
    return { type: 'tool_result', tool_use_id: toolUseId, content: out.result }
  },
})
