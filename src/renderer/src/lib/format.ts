// Shared display formatters. NOTE the deliberate non-merges: the context indicator keeps its own
// fmtContextTokens (below) and chat-segment.tsx its own fmtElapsed ("3m 12s" vs the dashboard's coarse
// "3m"); merging those would change visible strings, not just code.

// Dashboard-style token count: 1.2M / 12k / 999 (studio Overview + analytics share this exact shape).
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return Math.round(n / 1_000) + 'k'
  return String(n)
}

// Context-indicator token count: 43.1K / 1.05M / 999. Sibling of fmtTokens, NOT a duplicate — this one
// keeps a decimal of K (a window creeps up by hundreds; "43k" would sit still for a dozen turns), an
// uppercase unit, and two trimmed decimals of M (1M / 1.05M, never "1.0M"). Fractions arrive here (the
// unsent draft is counted as chars/4), so round before choosing a tier — otherwise the sub-K branch
// would leak "999.75".
export function fmtContextTokens(n: number): string {
  const v = Math.round(n)
  if (v >= 1_000_000) return `${parseFloat((v / 1_000_000).toFixed(2))}M`
  if (v < 1000) return String(v)
  const k = parseFloat((v / 1000).toFixed(1))
  // 999_950 rounds to "1000.0" K — carry into M rather than printing a four-digit K.
  return k >= 1000 ? `${parseFloat((v / 1_000_000).toFixed(2))}M` : `${k}K`
}
