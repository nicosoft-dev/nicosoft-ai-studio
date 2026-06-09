// Thinking-depth → API directive, MAIN-side mirror of renderer/src/lib/thinking.ts. The renderer resolves
// thinking for user-typed composer turns and ships a ThinkingParam over IPC; but the coordinator dispatches
// experts entirely inside main (runRoleStep → runDispatchedAgent / llmChat) and never touches the renderer,
// so it needs the same depth→param resolution here. Keep these tables in sync with the renderer copy — they
// change only when a provider adds a thinking tier. Mirrors getThinkingCapability + resolveThinking + clampDepth.

import type { ThinkingParam } from './types'

type Depth = 'minimal' | 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// Anthropic extended-thinking budgets — budget_tokens is the portable wire form any Anthropic endpoint accepts.
const ANTHROPIC_BUDGET: Partial<Record<Depth, number>> = { low: 1024, medium: 8192, high: 32768, xhigh: 49152, max: 65536 }
// Gemini 2.5 token budgets (no 'max' tier). Gemini 3 takes an effort level instead (GEMINI3_DEPTHS).
const GEMINI_PRO_BUDGET: Partial<Record<Depth, number>> = { low: 1024, medium: 8192, high: 32768 }
const GEMINI_FLASH_BUDGET: Partial<Record<Depth, number>> = { low: 1024, medium: 8192, high: 24576 }
const GEMINI3_DEPTHS: Depth[] = ['low', 'medium', 'high']

// Claude tiers by model: low/medium/high base; +max on Opus 4.6+; +xhigh on Opus 4.7+. Haiku can't think.
function anthropicDepths(slug: string): Depth[] {
  if (slug.includes('haiku')) return []
  const tiers: Depth[] = ['low', 'medium', 'high']
  const opus = /opus-4[.\-](\d+)/.exec(slug) // matches claude-opus-4-6 and claude-opus-4.6
  if (opus) {
    const minor = parseInt(opus[1], 10)
    if (minor >= 7) tiers.push('xhigh')
    if (minor >= 6) tiers.push('max')
  }
  return tiers
}

// OpenAI reasoning effort by model: o-series low/medium/high; gpt-5.0 minimal/low/medium/high;
// gpt-5.1–5.4 none/low/medium/high; gpt-5.5+ adds xhigh; gpt-4 and below: no reasoning effort.
function openaiDepths(slug: string): Depth[] {
  if (/(^|[/\-])o[1-9]/.test(slug)) return ['low', 'medium', 'high']
  const gpt = /gpt-(\d+)(?:\.(\d+))?/.exec(slug)
  if (!gpt || parseInt(gpt[1], 10) < 5) return []
  const major = parseInt(gpt[1], 10)
  const minor = gpt[2] ? parseInt(gpt[2], 10) : 0
  if (major === 5 && minor === 0) return ['minimal', 'low', 'medium', 'high']
  const tiers: Depth[] = ['none', 'low', 'medium', 'high']
  if (major > 5 || minor >= 5) tiers.push('xhigh')
  return tiers
}

// Pick the requested depth if the model supports it, else clamp to its highest supported tier (so 'max' on
// an effort-only model resolves to that model's top effort = the user's "think as hard as possible" intent).
function clamp(depth: Depth, supported: Depth[]): Depth | undefined {
  if (supported.length === 0) return undefined
  return supported.includes(depth) ? depth : supported[supported.length - 1]
}

// Resolve a stored depth string into the directive sent to the model. undefined = no thinking (model can't
// think, or depth unset). budgetTokens (Anthropic / Gemini 2.5) XOR effort (OpenAI / Gemini 3), never both.
export function resolveDepth(protocol: string, slug: string, depth: string | null | undefined): ThinkingParam | undefined {
  if (!depth) return undefined
  const s = (slug || '').toLowerCase()
  const d = depth as Depth

  if (protocol === 'anthropic') {
    const eff = clamp(d, anthropicDepths(s))
    const budget = eff ? ANTHROPIC_BUDGET[eff] : undefined
    return budget !== undefined ? { budgetTokens: budget } : undefined
  }
  if (protocol === 'openai' || protocol === 'custom') {
    const eff = clamp(d, openaiDepths(s))
    return eff ? { effort: eff as ThinkingParam['effort'] } : undefined
  }
  if (protocol === 'gemini') {
    if (s.includes('gemini-2.5')) {
      const mapping = s.includes('flash') ? GEMINI_FLASH_BUDGET : GEMINI_PRO_BUDGET
      const eff = clamp(d, Object.keys(mapping) as Depth[])
      const budget = eff ? mapping[eff] : undefined
      return budget !== undefined ? { budgetTokens: budget } : undefined
    }
    const major = /gemini-(\d+)/.exec(s)
    if ((major && parseInt(major[1], 10) >= 3) || s.endsWith('-latest')) {
      const eff = clamp(d, GEMINI3_DEPTHS)
      return eff ? { effort: eff as ThinkingParam['effort'] } : undefined
    }
    return undefined
  }
  return undefined
}
