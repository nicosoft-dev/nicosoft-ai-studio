// Provider-dispatched token counter. Anthropic uses a 3-tier strategy:
//   L1: POST /v1/messages/count_tokens — exact, free, model-specific (the real input the API will bill)
//   L2: a small-model max_tokens:1 probe, reading usage.input_tokens (+cache) — only if L1 is down
//   L3: roughTokenCountEstimation (chars/4, dense JSON /2, image=2000) — last resort
// Results are memoised per (model + system + messages + tools), so a resend / keystroke doesn't re-hit
// the network. Callers pass an Anthropic-native body (system split out, messages as Anthropic content);
// chat / agent each build that body from their own shape. Non-anthropic providers use rough for now.

import type { Protocol } from '../domain'
import { CHARS_PER_TOKEN } from '../llm/estimate'
import { trimBase } from '../llm/_shared'
import { ANTHROPIC_VERSION } from '../llm/anthropic-wire'

// Non-streaming count_tokens / probe requests have no SSE idle guard — bound them with a hard request timeout
// so a hung upstream can't wedge the synchronous countContext (it runs before every dispatched step). On
// timeout the fetch rejects, the try/catch returns null, and the caller falls through L1→L2→rough.
const COUNT_TIMEOUT_MS = 30_000

export interface AnthropicCountInput {
  baseUrl: string
  apiKey: string
  model: string // the conversation's MAIN model — count is model-specific (haiku≠opus through OAuth)
  system?: string
  messages: { role: string; content: unknown }[] // Anthropic-native (content: string | block[])
  tools?: unknown[] // Anthropic tool schemas (occupy real tokens — must be included for agent context)
  thinkingBudget?: number
  smallModel?: string // L2 probe model (pickSmallModel result); omit to skip L2
}

const cache = new Map<string, number>()
const CACHE_CAP = 2000

async function countAnthropic(input: AnthropicCountInput): Promise<number> {
  const key = hashKey(input)
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let n = await viaCountTokensApi(input) // L1
  if (n == null && input.smallModel) n = await viaSmallModelProbe(input) // L2
  if (n == null) n = roughCount(input) // L3

  if (cache.size >= CACHE_CAP) cache.clear() // crude bound — conversations churn the key space
  cache.set(key, n)
  return n
}

// Provider dispatch. Anthropic gets the 3-tier strategy; other providers use rough for now (OpenAI's
// tiktoken / Gemini's :countTokens can be wired in here later — see the token-count discussion).
export async function countContext(protocol: Protocol, input: AnthropicCountInput): Promise<number> {
  if (protocol === 'anthropic') return countAnthropic(input)
  return roughCount(input)
}

// What the prompt is MADE OF, for the composer's Context window panel. Stable ids, not labels — the
// renderer owns the wording (and its five translations).
export type ContextPart = 'system' | 'memory' | 'tools' | 'messages' | 'free'
export interface ContextBreakdown {
  parts: { id: ContextPart; tokens: number }[] // descending by tokens, 'free' always last
  total: number // T_all — the measured prompt (what the ring reads)
  max: number // the window
}

// Resolve the prompt into its parts. No API itemises a prompt, so each part is a DIFFERENCE between two
// nested prefixes, with tools falling out as the remainder:
//
//   T_base   = ()               → protocol overhead + the dummy turn bodyFor() injects
//   T_sysMin = (system−memory)  → System prompt  = T_sysMin − T_base
//   T_sys    = (system)         → auto-memory    = T_sys    − T_sysMin
//   T_msgs   = (messages)       → Messages       = T_msgs   − T_base
//   `total`  (from the caller)  → System tools   = total − the three above
//
// T_base MUST be subtracted: an empty-messages body still carries a dummy user turn (see bodyFor), which
// would otherwise inflate every part by ~8 tokens. Differencing cancels it.
//
// ⚠️ THE SUBTRAHENDS MUST SHARE A TIER, or the subtraction is meaningless. countContext is TIERED (exact
// count_tokens → billed small-model probe → local estimate) and the tiers disagree by large factors — an
// earlier cut mixed them and produced parts summing to 46.5K against a 30.4K total, a bar overflowing to
// 101.6%. The probes here share one config, and the monotonic guard rejects the breakdown outright if one
// still fell through. A confidently wrong picture of the prompt is worse than none.
//
// Deliberately NO smallModel: that tier is a REAL max_tokens:1 request, i.e. billed. A shading aid must
// never cost money. (Claude Code makes the opposite call — its fallback IS a billed haiku probe. It also
// counts each section independently rather than by differencing, which is why its panel says "Estimated
// usage by category". Ours says the same: the parts are differenced off the up-front count, while the
// header shows the ring's live measured usage, so the two are not meant to add up.)
//
// Cost: 4 free probes, memoised on (model+system+messages+tools) — T_base/T_sysMin never change within a
// conversation, so steady state is 0–2 real round trips. For openai/gemini it is pure CPU.
//
// CALLERS: never await this in front of a turn — see the fire-and-forget note at its call site.
export async function countBreakdown(
  protocol: Protocol,
  input: AnthropicCountInput, // the FULL body, exactly as passed to countContext
  opts: { systemNoMemory: string; total: number; max: number }
): Promise<ContextBreakdown | null> {
  // Every probe here is TOOL-FREE and shares one config, so they all land on the same tier and their
  // differences are meaningful. Tools are priced separately, below, precisely because they cannot join.
  const probe = (system: string | undefined, messages: AnthropicCountInput['messages']): Promise<number> =>
    countContext(protocol, { ...input, system, tools: undefined, messages, smallModel: undefined })
  const [tBase, tSysMin, tSys, tMsgs] = await Promise.all([
    probe(undefined, []),
    probe(opts.systemNoMemory, []),
    probe(input.system, []),
    probe(undefined, input.messages),
  ])
  // Same tier ⇒ monotonic. If not, a probe failed or fell through and the differences are noise.
  if (!(tBase <= tSysMin && tSysMin <= tSys) || tMsgs < tBase) return null
  const system = tSysMin - tBase
  const memory = tSys - tSysMin
  const messages = tMsgs - tBase
  // Tools are the RESIDUAL: the caller's `total` measured the whole prompt including them, so whatever it
  // holds beyond the three measured parts IS the tool cost. Pricing them locally instead (dense-JSON/2)
  // overpriced the kit ~1.8x and rendered "System tools" LARGER than the total one line above it. As a
  // residual it cannot exceed the total by construction, and it absorbs any gap between `total` and the
  // probes rather than letting that gap corrupt a measured part. Note it inherits whatever `total` is: an
  // exact count of the body count_tokens was ASKED about, which toolsForCounting narrowed — so server
  // tools land here as a small under-count, not as a wrong measured part.
  const tools = opts.total - system - memory - messages
  if (tools < 0) return null // parts already exceed the measured prompt → the numbers aren't comparable
  const parts: { id: ContextPart; tokens: number }[] = [
    { id: 'system', tokens: system },
    { id: 'memory', tokens: memory },
    { id: 'tools', tokens: tools },
    { id: 'messages', tokens: messages },
  ]
  parts.sort((a, b) => b.tokens - a.tokens) // biggest first — the panel lists them in this order
  // Anchored on the same total, so the five always span exactly the window: parts sum to total, and free is
  // the rest of it.
  parts.push({ id: 'free', tokens: Math.max(0, opts.max - opts.total) }) // always last — the remainder, not a part
  return { parts, total: opts.total, max: opts.max }
}

// L1 — the real endpoint. Free, not billed, supports system+messages+tools+thinking (verified live).
async function viaCountTokensApi(input: AnthropicCountInput): Promise<number | null> {
  try {
    const res = await fetch(`${trimBase(input.baseUrl)}/v1/messages/count_tokens`, {
      method: 'POST',
      headers: anthropicHeaders(input.apiKey),
      body: JSON.stringify(bodyFor(input.model, input, true)),
      signal: AbortSignal.timeout(COUNT_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { input_tokens?: unknown }
    return typeof json.input_tokens === 'number' ? json.input_tokens : null
  } catch {
    return null
  }
}

// L2 — borrow a real max_tokens:1 request on a small model and read its usage (input + cache split).
async function viaSmallModelProbe(input: AnthropicCountInput): Promise<number | null> {
  if (!input.smallModel) return null // no small model to borrow → this probe path doesn't apply
  const smallModel = input.smallModel
  try {
    const res = await fetch(`${trimBase(input.baseUrl)}/v1/messages`, {
      method: 'POST',
      headers: anthropicHeaders(input.apiKey),
      body: JSON.stringify({ ...bodyFor(smallModel, input, false), max_tokens: 1 }),
      signal: AbortSignal.timeout(COUNT_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
    }
    const u = json.usage
    if (!u || typeof u.input_tokens !== 'number') return null
    return u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  } catch {
    return null
  }
}

// Deliberately NOT the adapters' anthropicHeaders (llm/anthropic-wire): the counter probes send no
// User-Agent today and this keeps their wire shape unchanged — only the version constant is shared.
function anthropicHeaders(apiKey: string): Record<string, string> {
  return { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' }
}

// /v1/messages/count_tokens accepts a STRICTER tools param than /v1/messages does, and rejects the whole
// request — HTTP 400, "the request was rejected by the model provider" — over either of two things the
// generation endpoint takes happily. Both were measured against the live API, one tool at a time:
//   • SERVER tools (the ones with a `type`, e.g. tool_search_tool_regex_20251119): not accepted at all.
//   • `defer_loading` / `eager_input_streaming` / `strict` hints on a normal tool (EnterWorktree,
//     ExitWorktree carry defer_loading): stripping them alone turns that 400 into a 200.
// Claude Code does exactly these two: its Sap() drops the same three fields before every count_tokens
// call, and it never routes server tools through this endpoint.
// This is load-bearing for COST, not just for the panel: without it L1 fails on every agent turn (the kit
// always carries tool_search), so countAnthropic silently fell through to L2 — a real, BILLED
// max_tokens:1 request — once per turn, forever.
const COUNT_TOKENS_REJECTED_FIELDS = ['defer_loading', 'eager_input_streaming', 'strict'] as const
function toolsForCounting(tools: unknown[] | undefined): unknown[] {
  if (!tools?.length) return []
  return tools
    .filter((t) => !(t && typeof t === 'object' && typeof (t as { type?: unknown }).type === 'string' && (t as { type: string }).type !== ''))
    .map((t) => {
      if (!t || typeof t !== 'object') return t
      const rest = { ...(t as Record<string, unknown>) }
      for (const f of COUNT_TOKENS_REJECTED_FIELDS) delete rest[f]
      return rest
    })
}

// Shared body builder. Empty messages with tools still needs a dummy user turn so
// the tool token count comes back accurate.
// `forCountTokens` gates the tool narrowing above: ONLY /v1/messages/count_tokens is that strict. L2 is a
// real /v1/messages request, which takes the kit verbatim — narrowing it there would undercount the very
// server tools the turn actually pays for.
function bodyFor(model: string, input: AnthropicCountInput, forCountTokens: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: input.messages.length ? input.messages : [{ role: 'user', content: 'foo' }]
  }
  if (input.system) body.system = input.system
  const tools = forCountTokens ? toolsForCounting(input.tools) : (input.tools ?? [])
  if (tools.length) body.tools = tools
  if (input.thinkingBudget && input.thinkingBudget > 0) {
    body.thinking = { type: 'enabled', budget_tokens: input.thinkingBudget }
  }
  return body
}

// L3 — chars/4, dense JSON /2, image=2000 (per-block estimation). Conservative so an
// underestimate can't let context overflow the window unnoticed.
function roughCount(input: AnthropicCountInput): number {
  let t = 0
  if (input.system) t += Math.ceil(input.system.length / CHARS_PER_TOKEN)
  for (const m of input.messages) t += roughContent(m.content)
  if (input.tools?.length) t += Math.ceil(JSON.stringify(input.tools).length / 2)
  return t
}

function roughContent(content: unknown): number {
  if (typeof content === 'string') return Math.ceil(content.length / CHARS_PER_TOKEN)
  if (!Array.isArray(content)) return 0
  let t = 0
  for (const b of content as Record<string, unknown>[]) {
    if (b.type === 'text' && typeof b.text === 'string') t += Math.ceil(b.text.length / CHARS_PER_TOKEN)
    else if (b.type === 'image') t += 2000 // conservative image constant
    else if (b.type === 'tool_use') t += Math.ceil((String(b.name ?? '') + JSON.stringify(b.input ?? {})).length / CHARS_PER_TOKEN)
    else if (b.type === 'tool_result') t += roughContent(b.content)
    else t += Math.ceil(JSON.stringify(b).length / CHARS_PER_TOKEN)
  }
  return t
}

function hashKey(input: AnthropicCountInput): string {
  const s =
    input.model + '|' + (input.system ?? '') + '|' + JSON.stringify(input.messages) + '|' +
    (input.tools ? JSON.stringify(input.tools) : '')
  let h = 5381 // djb2
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return input.model + ':' + s.length + ':' + (h >>> 0).toString(36)
}
