import * as convRepo from '../repos/conversation.repo'
import * as summaryRepo from '../repos/summary.repo'
import * as endpointRepo from '../repos/endpoint.repo'
import * as keychain from '../keychain/keychain'
import * as memoryService from './memory.service'
import { chat as llmChat } from '../llm/client'
import type { MessageRow } from '../repos/conversation.repo'
import type { SummaryRow } from '../repos/summary.repo'
import { agentEvents } from './event-bus'
import * as roleRepo from '../repos/role.repo'

// Context compression. When a conversation's running context crosses 90% of the model's window, fold
// the older messages into a chained summary, keeping the most recent few verbatim. STEP 0 runs a
// synchronous memory extraction BEFORE folding, so long-term knowledge is captured before messages are
// summarized away. The summary chain (parent_id) lets each summary reference the previous one, and
// covered_up_to marks the boundary (a message id) so chat context assembly knows what's already folded.
// Best-effort: never throws into the chat flow.

const COMPRESS_RATIO = 0.9 // trigger at 90% of the context window
const KEEP_RECENT = 4 // messages kept verbatim after a compression (continuity tail)
// Context the assembler adds that maybeCompress can't measure here: recalled memories (≤ RECALL budget)
// + the role system prompt. Reserve for it so the threshold isn't an underestimate (better to compress
// a little early than overflow the window).
const RESERVED_CONTEXT_TOKENS = 2500

// Per-conversation in-memory lock (single main process) so two fast turns can't run overlapping
// compressions and fork the summary chain.
const compressing = new Set<string>()
const MAX_FOLD_CHARS = 200_000 // cap the transcript fed to the summary call so it can't itself overflow

const COMPRESS_SYSTEM = 'You are summarizing a conversation so it can continue without the full history.'
const COMPRESS_PROMPT = `Summarize the conversation below into a concise but complete summary that preserves the key facts, decisions, context, and the user's intent and preferences. This summary replaces the earlier messages — anything you omit is lost. If an existing summary is provided, integrate it. Write plain prose, no preamble.`

export interface CompressInput {
  convId: string
  roleId: string
  endpointId: string
  model: string
  contextWindow?: number // explicit window (Engineer passes its run window); falls back to the model catalog
  currentTokens?: number // exact prompt tokens (count_tokens) for this turn; preferred over the estimate
  force?: boolean // manual /compact — bypass the 90% threshold and fold now (still needs enough to fold)
}

export async function maybeCompress(input: CompressInput): Promise<void> {
  if (compressing.has(input.convId)) return // a compression for this conversation is already running
  compressing.add(input.convId)
  try {
    const ep = endpointRepo.getById(input.endpointId)
    if (!ep) return
    const ctxLen =
      input.contextWindow ?? ep.availableModels.find((m) => m.slug === input.model)?.contextLength ?? 0
    if (ctxLen <= 0) return // unknown window — can't compute a threshold

    const history = convRepo.listByConversation(input.convId)
    const prevSummary = summaryRepo.getLatest(input.convId)
    const recent =
      prevSummary?.coveredUpTo != null ? history.filter((m) => m.id > prevSummary.coveredUpTo!) : history

    // Prefer the exact prompt-token count the caller measured (count_tokens — already includes system,
    // memories, summary, recent turns AND tool schemas). Fall back to a chars/4 estimate + a reserve.
    const used =
      input.currentTokens != null
        ? input.currentTokens
        : estimateMessageTokens(recent) +
          (prevSummary ? estimateTextTokens(prevSummary.content) : 0) +
          RESERVED_CONTEXT_TOKENS
    if (!input.force && used < ctxLen * COMPRESS_RATIO) return // under threshold (force = manual /compact)
    if (recent.length <= KEEP_RECENT + 1) return // too little to fold usefully

    agentEvents.emit({ type: 'compact:pre', convId: input.convId, roleId: input.roleId, ts: Date.now() })

    // STEP 0: capture long-term memory synchronously before folding messages away.
    await memoryService.extract(
      { convId: input.convId, roleId: input.roleId, endpointId: input.endpointId, model: input.model },
      'auto'
    )

    const fold = recent.slice(0, recent.length - KEEP_RECENT) // older messages → summary
    const coveredUpTo = fold[fold.length - 1].id

    const key = keychain.getApiKey(input.endpointId)
    if (!key) return
    const summaryText = await foldSummary(fold, prevSummary, ep, key, input.model)
    if (!summaryText) return

    summaryRepo.create({
      conversationId: input.convId,
      parentId: prevSummary?.id ?? null, // chain: new summary references the previous one
      content: summaryText,
      coveredUpTo
    })
    agentEvents.emit({ type: 'compact:post', convId: input.convId, roleId: input.roleId, ts: Date.now() })
  } catch (err) {
    // best-effort: a compression failure must never break the chat flow, but surface it (CLAUDE.md)
    console.warn('[compression] failed for conversation', input.convId, err)
  } finally {
    compressing.delete(input.convId)
  }
}

// B2: manual compaction (the /compact command + future UI button). Resolves the conversation's role
// binding, then folds NOW regardless of the 90% threshold (force).
export async function compactNow(convId: string): Promise<void> {
  const conv = convRepo.getById(convId)
  if (!conv?.primaryRoleId) return
  const binding = roleRepo.getBinding(conv.primaryRoleId)
  if (!binding?.endpointId || !binding.model) return
  await maybeCompress({
    convId,
    roleId: conv.primaryRoleId,
    endpointId: binding.endpointId,
    model: binding.model,
    force: true
  })
}

// Fold the older messages (+ any prior summary) into one summary via the conversation's MAIN model —
// quality matters here, this replaces history. Returns null on empty output.
// B1: when the transcript is too big for one call, map-reduce (summarize each chunk, then merge) instead
// of the old slice(-MAX_FOLD_CHARS) which silently DROPPED the oldest turns. Each call retries once for
// transient failures so an overflow / network blip doesn't abandon the whole compaction.
async function foldSummary(
  fold: MessageRow[],
  prev: SummaryRow | null,
  ep: endpointRepo.EndpointRow,
  key: string,
  model: string
): Promise<string | null> {
  const lines = fold.map((m) => `${m.author === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
  const prior = prev ? `Existing summary so far:\n${prev.content}\n\n` : ''
  const transcript = lines.join('\n')

  // Common case: fits in one fold.
  if (transcript.length <= MAX_FOLD_CHARS) {
    return summarizeChunk(`${prior}Conversation:\n${transcript}`, ep, key, model)
  }

  // Too big for one call → summarize each chunk, then summarize the summaries. No message is dropped.
  const chunks = chunkByChars(lines, MAX_FOLD_CHARS)
  const partials: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const s = await summarizeChunk(`Conversation (part ${i + 1}/${chunks.length}):\n${chunks[i]}`, ep, key, model)
    if (s) partials.push(s)
  }
  if (!partials.length) return null
  if (partials.length === 1) return partials[0]
  return summarizeChunk(`${prior}Section summaries to merge into ONE summary:\n${partials.join('\n\n')}`, ep, key, model)
}

// One summary call with a single retry (transient overflow / network). Returns null on empty / failure.
async function summarizeChunk(
  body: string,
  ep: endpointRepo.EndpointRow,
  key: string,
  model: string
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await llmChat(
        {
          protocol: ep.protocol,
          baseUrl: ep.baseUrl,
          apiKey: key,
          model,
          messages: [
            { role: 'system', content: COMPRESS_SYSTEM },
            { role: 'user', content: `${COMPRESS_PROMPT}\n\n${body}` }
          ]
        },
        () => {} // non-streaming use
      )
      const text = result.text.trim()
      if (text) return text
    } catch (err) {
      if (attempt === 1) {
        console.warn('[compression] summary call failed after retry', err)
        return null
      }
    }
  }
  return null
}

// Split lines into chunks each ≤ maxChars (a single over-long line becomes its own chunk).
function chunkByChars(lines: string[], maxChars: number): string[] {
  const chunks: string[] = []
  let cur = ''
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > maxChars) {
      chunks.push(cur)
      cur = ''
    }
    cur = cur ? cur + '\n' + line : line
  }
  if (cur) chunks.push(cur)
  return chunks
}

function estimateMessageTokens(messages: MessageRow[]): number {
  let chars = 0
  for (const m of messages) {
    chars += m.content.length
    if (Array.isArray(m.attachments)) chars += m.attachments.length * 8_000 // ~2000 tokens/image
  }
  return Math.ceil(chars / 4)
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
