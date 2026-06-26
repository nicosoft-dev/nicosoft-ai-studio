// Studio Lens — the built-in code-review: the model GATE (who may author a script) + the fixed-taxonomy
// FALLBACK script (what runs when a model may not author, or its author attempt fails). This mirrors real
// Claude Code, which ships a built-in `code-review` workflow AND lets the strong driving model author its own
// — the two coexist, and the model/engine picks. 批 3 of the lens rewrite.
//
// Parallel track: this module is PURE (gate is a slug check; the template is a string; the args helper maps a
// TierShape) and touches NO existing lens path — it unit-tests off-Electron and is wired into agent-lens in 批 5.

import type { TierShape } from './tiers'

// ── model gate ──────────────────────────────────────────────────────────────────────────────────────────

// Only a strong, judgment-capable model may AUTHOR a deterministic orchestration script (§5.5). The fan-out
// then lives in the model's own creation view (it writes `pipeline(GROUPS,…)` and knows the count) rather than
// being multiplied by an engine — that is what makes the dynamic path safe (§1.2). A model that does not pass
// is NOT blocked from review: it falls back to the fixed CODE_REVIEW_TEMPLATE below, where the shape is bounded
// data, not author freedom. This is the HARD form of "constraint depends on the model's judgment".
//
// Slug parsing parallels src/shared/thinking.ts, but uses a GENERAL major regex (not thinking.ts's `-4[.\-]`
// literal) so future majors (opus 5/6, gpt 6) pass without a code change.
//
// Allowed (decided 2026-06-27): Opus 4+ · Sonnet 4.6+ · gpt-5+ · Fable — all including future majors. Excluded:
// ANY *-mini (weakened variant), Opus≤3, Sonnet≤4.5, gpt≤4, Gemini, everything else.
export function canAuthorScript(slug: string): boolean {
  const s = slug.toLowerCase()
  // any *-mini weakened variant (gpt-5-mini / o4-mini / future gpt-6-mini …). Word-boundary, NOT a bare
  // includes('mini') — that would also match "ge·mini" and deny Gemini for the wrong reason (a footgun if
  // Gemini is ever allowed). \bmini\b matches '-mini' but not the 'mini' inside 'gemini'.
  if (/\bmini\b/.test(s)) return false
  const cl = /(opus|sonnet)-(\d+)(?:[.\-](\d+))?/.exec(s)
  if (cl) {
    const major = parseInt(cl[2], 10)
    const minor = cl[3] ? parseInt(cl[3], 10) : 0
    if (cl[1] === 'opus' && major >= 4) return true // Opus 4+ (4.x / future 5, 6)
    if (cl[1] === 'sonnet' && (major > 4 || (major === 4 && minor >= 6))) return true // Sonnet 4.6+ (effort era)
  }
  if (s.includes('fable')) return true // Fable (Mythos-class, strongest)
  const gpt = /gpt-(\d+)/.exec(s)
  return !!(gpt && parseInt(gpt[1], 10) >= 5) // gpt-5+ (5.x / future 6.0 …)
}

// ── built-in fallback template ──────────────────────────────────────────────────────────────────────────

// A generic code-review orchestration script. The review SHAPE (which angles, the candidate cap, the verify
// bias, the gap-sweep, the report cap) is NOT hardcoded here — it arrives as `args`, resolved by the caller
// from the reviewer's effort tier (codeReviewArgs below), exactly as Workflow's code-review reads its shape
// from the effort tier at runtime. So this ONE template serves every tier: a non-authoring model still gets a
// real, tier-appropriate review, with the fan-out bounded by data (angles.length × candidateCap) — never by
// author freedom. The script uses only the injected primitives (agent/parallel/phase/log) + args.
export const CODE_REVIEW_TEMPLATE = `export const meta = {
  name: 'code-review',
  description: 'Built-in fixed-taxonomy code review: a finder per angle, adversarial verify, a synthesized most-severe-first report.',
  phases: [{ title: 'Review' }, { title: 'Verify' }, { title: 'Synthesize' }],
}

const { target = 'the changes', angles = [], candidateCap = 6, verify = 'recall', sweep = false, reportCap = 10 } = args ?? {}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, line: { type: 'number' }, summary: { type: 'string' }, severity: { type: 'string' } },
        required: ['file', 'summary'],
      },
    },
  },
  required: ['findings'],
}
const VERDICT = { type: 'object', properties: { stands: { type: 'boolean' }, reason: { type: 'string' } }, required: ['stands'] }

phase('Review')
log('code-review: ' + target + ' — ' + angles.length + ' angle(s), <=' + candidateCap + ' candidates each, verify=' + verify + (sweep ? ' +sweep' : ''))
const found = await parallel(angles.map((a) => () =>
  agent(
    'Review ' + target + ' through ONE lens:\\n' + a.focus + '\\n\\nFind up to ' + candidateCap + ' REAL issues this lens catches. For each: the file and line, a one-line summary, the severity, and concrete evidence. Pin only the changed code; do not invent issues.',
    { label: 'find:' + a.key, phase: 'Review', schema: FINDINGS },
  )))
const candidates = found.filter(Boolean).flatMap((f) => (f && f.findings) || [])

let confirmed = candidates.map((c) => ({ ...c, stands: true }))
if (verify !== 'none' && candidates.length > 0) {
  phase('Verify')
  const recall = verify === 'recall'
  const verdicts = await parallel(candidates.map((c) => () =>
    agent(
      'Adversarially check this finding against the code. ' + (recall ? 'KEEP it unless you can refute it from the code (recall bias).' : 'DROP it unless you can confirm it from the code (precision bias).') + '\\n\\n' + c.summary + ' @ ' + c.file + ':' + (c.line || '?'),
      { label: 'verify:' + c.file, phase: 'Verify', schema: VERDICT },
    ).then((v) => ({ ...c, stands: v && typeof v.stands === 'boolean' ? v.stands : recall }))))
  confirmed = verdicts.filter(Boolean).filter((c) => c.stands)
}

if (sweep) {
  phase('Verify')
  const extra = await agent(
    'Gap sweep: re-read ' + target + ' and surface any REAL issue the angle-finders missed (up to ' + candidateCap + '). Same evidence bar.',
    { label: 'sweep', phase: 'Verify', schema: FINDINGS },
  )
  if (extra && extra.findings) confirmed = confirmed.concat(extra.findings.map((f) => ({ ...f, stands: true })))
}

phase('Synthesize')
const top = confirmed.slice(0, reportCap)
return await agent(
  'Write the code-review report for ' + target + ': the ' + top.length + ' confirmed finding(s), most-severe-first, each citing file:line with a crisp explanation and a concrete fix. If there are none, say the change looks clean.\\n\\nConfirmed findings:\\n' + JSON.stringify(top),
  { label: 'report', phase: 'Synthesize' },
)
`

// ── shape → args ────────────────────────────────────────────────────────────────────────────────────────

export interface CodeReviewArgs {
  target: string
  angles: { key: string; focus: string }[]
  candidateCap: number
  verify: 'none' | 'precision' | 'recall'
  sweep: boolean
  reportCap: number
}

// Resolve a TierShape (+ what to review) into the CODE_REVIEW_TEMPLATE's args. The bridge tiers.ts → template:
// agent-lens (批 5) calls this with the reviewer's tier shape + the review target, then runs the template.
export function codeReviewArgs(shape: TierShape, target: string): CodeReviewArgs {
  return {
    target,
    angles: shape.angles.map((a) => ({ key: a.key, focus: a.focus })),
    candidateCap: shape.candidateCap,
    verify: shape.verify,
    sweep: shape.sweep,
    reportCap: shape.reportCap,
  }
}
