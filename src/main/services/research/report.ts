// Studio research — the PURE report formatter: the deep-research script's structured return value → a cited
// markdown report for the research card. Kept free of the consumer's agent/Electron chain so it is unit-testable
// off-Electron (e2e/research-deep-research.mts) and reused by the service without dragging the runtime.

interface Finding {
  claim?: string
  confidence?: string
  sources?: string[]
  evidence?: string
  vote?: string
}
interface ResearchValue {
  question?: string
  summary?: string
  findings?: Finding[]
  caveats?: string
  openQuestions?: string[]
  refuted?: { claim?: string; vote?: string; source?: string }[]
  unverified?: { claim?: string }[]
  stats?: Record<string, number>
}

// Render the deep-research return value as a cited markdown report. Tolerant of EVERY shape the script can
// return (full report / no-claims / all-refuted / infra-failure) — a missing section is simply omitted, and the
// summary (always present) carries the headline outcome. The stats footer documents the fan-out that produced it.
export function formatReport(value: unknown): string {
  const v = (value ?? {}) as ResearchValue
  const parts: string[] = []
  if (v.question) parts.push(`## Research: ${v.question}`)
  if (v.summary) parts.push(v.summary)

  const findings = Array.isArray(v.findings) ? v.findings : []
  if (findings.length > 0) {
    const lines = findings.map((f, i) => {
      const head = `**${i + 1}. ${f.claim ?? '(claim)'}**${f.confidence ? ` — _${f.confidence} confidence_` : ''}`
      const ev = f.evidence ? `\n   ${f.evidence}` : ''
      const src = Array.isArray(f.sources) && f.sources.length ? `\n   Sources: ${f.sources.join(', ')}` : ''
      return head + ev + src
    })
    parts.push(`### Findings\n${lines.join('\n\n')}`)
  }

  if (v.caveats) parts.push(`### Caveats\n${v.caveats}`)

  const open = Array.isArray(v.openQuestions) ? v.openQuestions : []
  if (open.length > 0) parts.push(`### Open questions\n${open.map((q) => `- ${q}`).join('\n')}`)

  const refuted = Array.isArray(v.refuted) ? v.refuted : []
  if (refuted.length > 0) {
    parts.push(
      `### Refuted (dropped by adversarial verification)\n${refuted
        .map((r) => `- ${r.claim ?? '(claim)'}${r.vote ? ` _(vote ${r.vote})_` : ''}`)
        .join('\n')}`,
    )
  }

  const s = v.stats
  if (s && typeof s === 'object') {
    const angles = s.angles ?? 0
    const sources = s.sourcesFetched ?? s.sources ?? 0
    const claims = s.claimsExtracted ?? s.claims ?? 0
    const confirmed = s.confirmed ?? 0
    const killed = s.killed ?? 0
    const unverified = s.unverified ?? 0
    parts.push(
      `---\n${angles} angle(s) · ${sources} source(s) · ${claims} claim(s) → ${confirmed} confirmed · ${killed} refuted · ${unverified} unverified`,
    )
  }
  return parts.join('\n\n')
}
