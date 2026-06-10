// Cross-process single source for the thinking-depth model: which tiers each provider/model exposes and
// what each tier resolves to on the wire. Replaces the hand-mirrored tables that lived in BOTH
// main/llm/thinking.ts and renderer/lib/thinking.ts ("Keep these tables in sync" — now there is one).
// main resolves depths for coordinator-dispatched experts; the renderer resolves them for composer turns
// and drives the picker UI. Environment-neutral: no node, no DOM.

// Thinking tiers across providers, each offered only where the model supports it:
//   Anthropic (budget): low/medium/high/xhigh/max — by Opus version; 4.6+ additionally offers Adaptive
//   OpenAI (effort):    none/minimal/low/medium/high/xhigh — by GPT version
//   Gemini (effort/budget): low/medium/high
// 'xhigh' shows as "Extra"; 'minimal'/'none' are OpenAI's sub-low tiers; 'max' is Anthropic-only.
export type EffortLevel = 'minimal' | 'none' | 'low' | 'medium' | 'high' | 'xhigh'
export type ThinkingDepth = EffortLevel | 'max'
// What a role/composer can STORE as its pick: an explicit tier, or 'adaptive' (Anthropic 4.6+ —
// the model self-budgets). Product decision 2026-06-11: every pick is user-selectable per role and
// the DEFAULT (nothing stored) is the model's TOP tier — think as hard as possible unless dialed down.
export type ThinkingChoice = ThinkingDepth | 'adaptive'

// Resolved directive sent with a request.
//   effort       — OpenAI Responses / Gemini 3 reasoning level, AND Anthropic effort-capable models
//                  (Opus 4.5+/Sonnet 4.6+: wire = output_config.effort; 'max' is Anthropic-only)
//   budgetTokens — LEGACY Anthropic extended thinking (pre-effort Claude) / Gemini 2.5 thinkingBudget
//   adaptive     — Anthropic 4.6+ thinking {type:"adaptive"}; combines WITH effort (a tier pick on
//                  4.6+ resolves to adaptive+effort; the bare "Adaptive" choice is adaptive alone)
// budgetTokens never combines with the others; budget on 4.7+/Fable is a hard 400 upstream.
export interface ThinkingParam {
  effort?: EffortLevel | 'max'
  budgetTokens?: number
  adaptive?: boolean
}

// Endpoint protocol → the model family the thinking engine (and the agent loop) reasons about.
// openai + custom are both Responses-API; unknown protocols → null (no thinking, no agent support).
export type ProtocolFamily = 'anthropic' | 'openai' | 'gemini' | null
export function protocolFamily(protocol: string): ProtocolFamily {
  if (protocol === 'anthropic') return 'anthropic'
  if (protocol === 'gemini') return 'gemini'
  if (protocol === 'openai' || protocol === 'custom') return 'openai'
  return null
}

// LEGACY Claude tiers expressed as extended-thinking budgets — the compatibility path for models that
// PREDATE the effort parameter (Sonnet ≤4.5, Opus ≤4.1, Claude 3.x). Effort-capable models (Opus 4.5+,
// Sonnet 4.6+, Fable) never take budgets: budget_tokens is deprecated on 4.6 and a hard 400 on
// 4.7+/Fable — they go through output_config.effort (see anthropicEffortDepths).
export const ANTHROPIC_BUDGET: Partial<Record<ThinkingDepth, number>> = {
  low: 1024,
  medium: 8192,
  high: 32768
}
// Gemini 2.5 budgets — sub-model token ceilings (no 'max' tier). Gemini 3 takes an effort level instead.
export const GEMINI_PRO_BUDGET: Partial<Record<ThinkingDepth, number>> = { low: 1024, medium: 8192, high: 32768 }
export const GEMINI_FLASH_BUDGET: Partial<Record<ThinkingDepth, number>> = { low: 1024, medium: 8192, high: 24576 }
// Gemini-3 effort knob — three native levels.
export const GEMINI3_DEPTHS: ThinkingDepth[] = ['low', 'medium', 'high']

// LEGACY Claude budget tiers — only reached for models WITHOUT effort support (Sonnet ≤4.5, Opus ≤4.1,
// Claude 3.x). Haiku never thinks. Effort-capable models are routed to anthropicEffortDepths by
// thinkingKnob before this is consulted.
export function anthropicDepths(slug: string): ThinkingDepth[] {
  if (slug.includes('haiku')) return []
  return ['low', 'medium', 'high']
}

// Anthropic effort tiers by model (wire = output_config.effort; verified against the API docs):
//   Opus 4.5          → low/medium/high
//   Opus 4.6          → low/medium/high/max          ('max' arrives with 4.6)
//   Opus 4.7+ / Fable → low/medium/high/xhigh/max    ('xhigh' arrives with 4.7)
//   Sonnet 4.6+       → low/medium/high/max
//   everything older  → [] (legacy budget path)
export function anthropicEffortDepths(slug: string): ThinkingDepth[] {
  if (slug.includes('haiku')) return []
  if (slug.includes('fable')) return ['low', 'medium', 'high', 'xhigh', 'max']
  const m = /(opus|sonnet)-4[.\-](\d+)/.exec(slug) // claude-opus-4-8 / claude-sonnet-4.6
  if (!m) return []
  const minor = parseInt(m[2], 10)
  if (m[1] === 'opus') {
    if (minor >= 7) return ['low', 'medium', 'high', 'xhigh', 'max']
    if (minor >= 6) return ['low', 'medium', 'high', 'max']
    if (minor >= 5) return ['low', 'medium', 'high']
    return []
  }
  return minor >= 6 ? ['low', 'medium', 'high', 'max'] : []
}

// OpenAI reasoning effort by model (verified against the OpenAI API docs):
//   o-series (o1/o3…)          → low/medium/high
//   gpt-5.0 (gpt-5, gpt-5-mini)→ minimal/low/medium/high   (minimal = fastest)
//   gpt-5.1–5.4                → none/low/medium/high       (none replaces minimal)
//   gpt-5.5+                   → none/low/medium/high/xhigh
//   gpt-4 and below            → no reasoning effort
export function openaiDepths(slug: string): ThinkingDepth[] {
  if (/(^|[/\-])o[1-9]/.test(slug)) return ['low', 'medium', 'high']
  const gpt = /gpt-(\d+)(?:\.(\d+))?/.exec(slug)
  if (!gpt || parseInt(gpt[1], 10) < 5) return []
  const major = parseInt(gpt[1], 10)
  const minor = gpt[2] ? parseInt(gpt[2], 10) : 0
  if (major === 5 && minor === 0) return ['minimal', 'low', 'medium', 'high']
  const tiers: ThinkingDepth[] = ['none', 'low', 'medium', 'high']
  if (major > 5 || minor >= 5) tiers.push('xhigh')
  return tiers
}

// Opus/Sonnet 4.6+ and Fable are trained on adaptive thinking — the model self-budgets when sent
// thinking {type:"adaptive"}. Offered as a selectable choice next to the effort tiers; a tier pick on
// these models rides WITH adaptive (adaptive + output_config.effort). Haiku never thinks.
export function supportsAdaptiveThinking(slug: string): boolean {
  if (slug.includes('haiku')) return false
  if (slug.includes('fable')) return true
  const m = /(opus|sonnet)-4[.\-](\d+)/.exec(slug) // claude-opus-4-8 / claude-sonnet-4.6
  return m ? parseInt(m[2], 10) >= 6 : false
}

// Pick the requested depth if the model supports it, else clamp to its highest supported tier (so 'max' on
// an effort-only model resolves to that model's top effort = the user's "think as hard as possible" intent).
export function clampDepth(depth: ThinkingDepth, supported: ThinkingDepth[]): ThinkingDepth | undefined {
  if (supported.length === 0) return undefined
  return supported.includes(depth) ? depth : supported[supported.length - 1]
}

// Which thinking knob a (family, slug) exposes — THE single source both processes resolve from
// (renderer capability/picker, main resolveDepth).
//   effort — enum knob: OpenAI Responses / Gemini 3 / Anthropic effort-capable models (Opus 4.5+,
//            Sonnet 4.6+, Fable — wire = output_config.effort). adaptiveOption marks Anthropic 4.6+:
//            'adaptive' is selectable alongside the tiers, and a tier pick rides WITH adaptive.
//   budget — token allowance: LEGACY Anthropic (pre-effort Claude) / Gemini 2.5 thinkingBudget.
export type ThinkingKnob =
  | { kind: 'none' }
  | { kind: 'effort'; depths: ThinkingDepth[]; adaptiveOption?: boolean }
  | { kind: 'budget'; mapping: Partial<Record<ThinkingDepth, number>> }

function budgetsFor(depths: ThinkingDepth[], table: Partial<Record<ThinkingDepth, number>>): Partial<Record<ThinkingDepth, number>> {
  const out: Partial<Record<ThinkingDepth, number>> = {}
  for (const d of depths) if (table[d] !== undefined) out[d] = table[d]
  return out
}

export function thinkingKnob(family: ProtocolFamily, slug: string): ThinkingKnob {
  const s = (slug || '').toLowerCase()
  if (!s || !family) return { kind: 'none' }
  if (family === 'anthropic') {
    // Effort-capable Claude goes through output_config.effort, uniformly — budget_tokens is the
    // COMPATIBILITY path for models that predate effort (deprecated on 4.6, hard 400 on 4.7+/Fable).
    const effort = anthropicEffortDepths(s)
    if (effort.length > 0) {
      return { kind: 'effort', depths: effort, ...(supportsAdaptiveThinking(s) ? { adaptiveOption: true } : {}) }
    }
    const depths = anthropicDepths(s)
    if (depths.length === 0) return { kind: 'none' }
    return { kind: 'budget', mapping: budgetsFor(depths, ANTHROPIC_BUDGET) }
  }
  if (family === 'openai') {
    const depths = openaiDepths(s)
    return depths.length === 0 ? { kind: 'none' } : { kind: 'effort', depths }
  }
  // Gemini wire split: 2.5 takes a token thinkingBudget; 3+ — including the rolling -latest aliases
  // (gemini-pro-latest / gemini-flash-latest, tracking the newest 3.x) — takes a thinkingLevel.
  // Older / non-thinking models (2.0, 1.x, imagen, nano-banana) expose nothing.
  if (s.includes('gemini-2.5')) {
    const table = s.includes('flash') ? GEMINI_FLASH_BUDGET : GEMINI_PRO_BUDGET
    return { kind: 'budget', mapping: { ...table } }
  }
  const major = /gemini-(\d+)/.exec(s)
  if ((major && parseInt(major[1], 10) >= 3) || s.endsWith('-latest')) return { kind: 'effort', depths: GEMINI3_DEPTHS }
  return { kind: 'none' }
}

// The tier list a knob exposes (no 'adaptive' — that's a mode, not a tier).
export function knobDepths(knob: ThinkingKnob): ThinkingDepth[] {
  if (knob.kind === 'effort') return knob.depths
  if (knob.kind === 'budget') return (Object.keys(knob.mapping) as ThinkingDepth[]).filter((d) => knob.mapping[d] !== undefined)
  return []
}

// Default for a role with no stored pick: the model's TOP tier. Adaptive stays opt-in.
export function highestDepth(family: ProtocolFamily, slug: string): ThinkingDepth | undefined {
  const depths = knobDepths(thinkingKnob(family, slug))
  return depths.length ? depths[depths.length - 1] : undefined
}
