// suggestion-filter.ts — quality gate for generated prompt suggestions (docs/prompt-suggestion-design.md §3.3).
// Mirrors CC 2.1.209's post-generation reject list verbatim, with ONE deliberate divergence: word counting is
// CJK-aware. CC counts words by splitting on whitespace, which rejects almost every Chinese suggestion as
// "too few words" ("修一下根因" = 1 token by \s+). Here a word is a whitespace-separated non-CJK token, and
// every 4 CJK characters count as one more word — so the same 2..12-word shape constraint carries over.
// Pure functions, no imports — unit-tested directly (e2e/suggestion-filter.mts).

export type SuggestionVerdict = { ok: true; text: string } | { ok: false; reason: string }

// CC strips a wrapper tag (<suggestion>…</suggestion> etc.) only when the inner text does not itself
// contain a closing tag of the same name (a nested/malformed wrapper is left alone), then a label prefix.
const WRAP_RE = /^<(suggestion|response|output|answer|result)>([\s\S]*)<\/\1>$/i
const PREFIX_RE = /^\s*(suggested\s+(response|reply|input|prompt)|suggestion|response|reply|answer|output|result)\s*:\s*/i
const PREFIX_CJK_RE = /^\s*(建议|回复|输入|提示)\s*[::]\s*/

export function stripSuggestion(raw: string): string {
  let s = raw.trim()
  s = s.replace(WRAP_RE, (whole, tag: string, inner: string) =>
    inner.includes(`</${tag.toLowerCase()}>`) || inner.includes(`</${tag.toUpperCase()}>`) ? whole : inner,
  )
  return s.replace(PREFIX_RE, '').replace(PREFIX_CJK_RE, '').trim()
}

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g

// 3 CJK characters ≈ one semantic word — keeps CC's 2..12-word shape constraint meaningful for CJK input
// (12 words ≈ 36 CJK chars; at 4:1 a 44-char run-on instruction still passed the cap).
export function effectiveWordCount(text: string): number {
  const cjkChars = text.match(CJK_RE)?.length ?? 0
  const nonCjk = text.replace(CJK_RE, ' ').trim()
  const words = nonCjk ? nonCjk.split(/\s+/).length : 0
  return words + Math.ceil(cjkChars / 3)
}

// CC's single-word whitelist (a one-word command IS a natural next input) + Chinese equivalents.
const ONE_WORD_OK = new Set([
  'yes', 'yeah', 'yep', 'yea', 'yup', 'sure', 'ok', 'okay', 'push', 'commit', 'deploy', 'stop',
  'continue', 'check', 'exit', 'quit', 'no',
  '好', '好的', '继续', '停', '停止', '提交', '推送', '部署', '确认', '退出', '可以',
])

// CC's evaluative reject (the user would not actually type these) + Chinese pleasantries.
const EVALUATIVE_RE = /thanks|thank you|looks good|sounds good|that works|that worked|that's all|nice|great|perfect|谢谢|辛苦|很好|太好了|完美|没问题|可以了/i

const META_TEXT_RE = /\bsilence is\b|\bstay(s|ing)? silent\b|保持沉默/
const ERROR_PREFIXES = ['api error:', 'prompt is too long', 'request timed out', 'invalid api key', 'image was too large']

// Reject rules in CC's evaluation order; first hit wins. Returns the reason slug (for the suppressed log).
export function filterSuggestion(raw: string): SuggestionVerdict {
  const text = stripSuggestion(raw)
  if (!text) return { ok: false, reason: 'empty' }
  const lower = text.toLowerCase()
  const words = effectiveWordCount(text)

  if (lower === 'done') return { ok: false, reason: 'done' }
  if (
    lower === 'nothing found' || lower === 'nothing found.' || lower.startsWith('nothing to suggest') ||
    lower.startsWith('no suggestion') || /^(没有|暂无|无)(可)?建议/.test(text) ||
    META_TEXT_RE.test(lower) || /^\W*silence\W*$/.test(lower)
  ) return { ok: false, reason: 'meta_text' }
  if (/^\(.*\)$|^\[.*\]$/s.test(text)) return { ok: false, reason: 'meta_wrapped' }
  if (ERROR_PREFIXES.some((p) => lower.startsWith(p))) return { ok: false, reason: 'error_message' }
  if (/^\w+:\s/.test(text) || /^[一-鿿]{1,4}[::]/.test(text)) return { ok: false, reason: 'prefixed_label' }
  if (words < 2 && !text.startsWith('/') && !ONE_WORD_OK.has(lower)) return { ok: false, reason: 'too_few_words' }
  if (words > 12) return { ok: false, reason: 'too_many_words' }
  if (text.length >= 100) return { ok: false, reason: 'too_long' }
  // CC: sentence break = terminal punctuation + space + capital. CJK sentences carry no spaces, so a CJK
  // terminator anywhere before the end is a break too (a trailing 。is fine — still one sentence).
  if (/[.!?]\s+[A-Z]/.test(text) || /[。!?](?!\s*$)/.test(text)) return { ok: false, reason: 'multiple_sentences' }
  if (/[\n*]/.test(text)) return { ok: false, reason: 'has_formatting' }
  if (EVALUATIVE_RE.test(lower)) return { ok: false, reason: 'evaluative' }
  return { ok: true, text }
}
