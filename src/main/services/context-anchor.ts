// Per-conversation ServerObserved context anchor.
//
// The prompt this app sends gets priced by the server on every single turn, and that price comes back in the
// response's usage. Counting the same prompt ourselves — locally, or by asking a counting endpoint about it
// up front — re-derives a number we are about to be told for free, and measurement says we re-derive it
// badly. Against the live API, three turns per provider, the up-front count vs the server's own figure:
//
//   openai    gpt-5.5     predicted 46508 / 46566 / 46593   observed 22649 / 22704 / 22738   → +105%
//   anthropic opus-4-8    predicted 38291 / 38360 / 38447   observed 40128 / 40197 / 40284   → −4.6%
//
// The revealing part is the ABSOLUTE error: 23859 / 23862 / 23855 for openai, and −1837 / −1837 / −1837 —
// identical to the token — for anthropic. The context grew each turn and the error did not move, so the error
// is not in the message estimate at all. It is entirely in the tools term, and it is a different bug on each
// side: roughCount prices tool schemas at chars/2 (~2.05x the truth), while count_tokens gets the kit with
// its server tools stripped (toolsForCounting must, or the endpoint 400s) and nothing ever prices them back.
//
// So don't price the tools. Anchor on a turn the server already priced, and locally estimate only what has
// been appended since — a message or two, where chars/4 is worth what it costs. This is Claude Code's
// opposite (it re-counts the whole payload every turn, and pays a billed haiku probe when its gateway can't)
// and it is what OpenAI's own codex does: `AutoCompactWindowPrefill::ServerObserved(usage.input_tokens)` in
// codex-rs/core/src/state/auto_compact_window.rs, taken from the first usage sample and never overwritten by
// an estimate. codex anchors on its LAST turn; we anchor on the FIRST turn of a run, because our messages
// table keeps only final replies — a run's tool traffic lives in the session transcript and is gone from the
// next seed, so only the first turn measures what actually persists.
//
// In memory only, like codex's own (it holds this in session state and carries an Estimated tier for exactly
// the gap where no sample has landed yet). A restart drops the anchor and the next turn falls back to
// countContext — a cold start, not a wrong answer.
//
// Split in two on purpose: this module owns VALIDITY and the arithmetic, the caller owns rendering the tail.
// The seed is not a per-message function of the history — conversationToAgentMessages elides all but the most
// recent MAX_REPLAY_IMAGES across the WHOLE list — so only the caller, holding the real mapping, can say what
// the tail actually costs.

export interface ContextAnchor {
  tokens: number // ServerObserved: the FIRST turn's prompt, as the server priced it
  upToMsgId: string // last message covered by `tokens` — the tail is everything after it
  model: string // a different model is a different tokenizer, so the same bytes carry a different price
  toolsFp: string // identity of the tool kit — see the note on read()
  systemLen: number // system-prompt length when anchored, to correct for drift (memories are recalled per turn)
  images: number // replayable images in the seed when anchored — see the elision guard in read()
  coveredUpTo: string | null // the summary boundary when anchored — any change means a compaction rewrote the seed
}

/**
 * Cheap identity for a value the anchor's price BAKED IN and has no correction term for — the tool kit.
 * Not derivable from the model: agent.service assembles the kit from the role, whether a cwd is set (no cwd
 * strips Read), the per-run extraTools a backend-orchestrated turn passes, and whatever MCP/Skill tools are
 * installed for the role's scope. Any of those can move while the model does not, so hashing the schemas is
 * the only honest key. djb2 over the serialized schemas, length-prefixed.
 */
export function fingerprint(v: unknown): string {
  const s = JSON.stringify(v) ?? ''
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return s.length + ':' + (h >>> 0).toString(36)
}

// Keyed by conversation AND role: a conversation can route turns to different experts (an @mention
// follow-up), and each carries its own system prompt and its own kit. One anchor per pair keeps them from
// evicting each other on every switch.
const anchors = new Map<string, ContextAnchor>()
const keyOf = (convId: string, roleId: string): string => `${convId} ${roleId}`
// Conversations churn; without a bound this map is a slow leak in a long-lived main process. Anchors are pure
// cache — dropping one costs a single fallback count — so a crude whole-map clear is the right cheap answer.
const CAP = 500

export function record(convId: string, roleId: string, a: ContextAnchor): void {
  if (anchors.size >= CAP) anchors.clear()
  anchors.set(keyOf(convId, roleId), a)
}

/**
 * The anchor if it still describes this seed, else null (caller counts for real).
 * `maxImages` is the seed's replay cap, so this can tell a new image from a SWAPPED one.
 */
export function read(
  convId: string,
  roleId: string,
  now: { model: string; toolsFp: string; coveredUpTo?: string | null; msgIds: string[]; images: number; maxImages: number },
): ContextAnchor | null {
  const a = anchors.get(keyOf(convId, roleId))
  if (!a) return null
  // A different tokenizer prices the same bytes differently — the old figure does not transfer, and there is
  // no honest way to scale it. Re-anchor from the next turn's usage instead.
  if (a.model !== now.model) return null
  // The kit is INSIDE a.tokens and nothing here corrects for it, so it has to be identical, not merely
  // plausible. It moves without the model moving: a per-run extraTools, a cwd appearing (which restores Read),
  // an MCP server or skill installing tools, a role with a different core set.
  if (a.toolsFp !== now.toolsFp) return null
  // A compaction landed: messages the anchor priced were folded away and the system now carries a summary that
  // wasn't there — the prompt was rewritten underneath us and nothing about the old price survives. Compare
  // the BOUNDARY, not the watermark against it: a fold keeps the KEEP_RECENT newest turns, so coveredUpTo is
  // always older than the anchor's own watermark and "has the watermark been folded" is never true, however
  // much of the prompt vanished. Any movement of the boundary is the signal. (codex clears its prefill on the
  // same event: clear_prefill() on window advance.)
  if ((now.coveredUpTo ?? null) !== a.coveredUpTo) return null
  // Past the replay cap, a new image does not ADD to the prompt — it evicts the oldest one. The tail would
  // bill us for the arrival while the anchor still carries the departure, so the sum drifts by an image every
  // time. Only re-anchoring can see that; the tail cannot.
  if (a.images !== now.images && Math.max(a.images, now.images) > now.maxImages) return null
  // The watermark isn't in this seed at all — history was rewritten some other way (fork, retract, an edited
  // turn). Without it we cannot tell "nothing new" from "different conversation".
  if (!now.msgIds.some((id) => id === a.upToMsgId)) return null
  return a
}

/** anchor + tail + system drift. `tailTokens` is the caller's estimate of everything after `upToMsgId`. */
export function combine(a: ContextAnchor, tailTokens: number, systemLenNow: number): number {
  // The system prompt is rebuilt every turn (memories are recalled fresh, the project map can change), so it
  // drifts under a fixed anchor. Correct with the SAME chars/4 estimator on both sides: the estimator's own
  // bias sits in each term and cancels in the difference, leaving just the drift. Signed — memories leave too.
  const systemDrift = Math.round((systemLenNow - a.systemLen) / 4)
  return Math.max(0, a.tokens + tailTokens + systemDrift)
}
