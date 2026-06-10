// Single source for the rough "characters per token" heuristic. Several call sites independently wrote
// `Math.ceil(str.length / 4)` (memory token cost, compression size, transcript freed-bytes) — the same
// magic ratio copied 5×, so tuning it meant hunting every copy. They now share this. NOT a replacement
// for the real upstream count_tokens (token-count.service L1/L2) — this is the conservative L3 fallback,
// deliberately an over-estimate so an undercount can't silently overflow a context window.

export const CHARS_PER_TOKEN = 4

// Rough token count for a single string. Use for memory cost, compaction freed-bytes, and any place that
// needs a cheap text→tokens estimate without an upstream call.
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}
