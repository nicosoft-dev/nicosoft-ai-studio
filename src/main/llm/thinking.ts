// Thinking-depth → API directive, main-side resolver over the cross-process tables in @shared/thinking.
// The renderer resolves thinking for user-typed composer turns and ships a ThinkingParam over IPC; but the
// coordinator dispatches experts entirely inside main (runRoleStep → runDispatchedAgent / llmChat) and never
// touches the renderer, so it needs the same depth→param resolution here. The tables/probes themselves are
// single-sourced — this file only owns the protocol-string → directive mapping.

import {
  clampDepth,
  knobDepths,
  protocolFamily,
  thinkingKnob,
  type ThinkingChoice,
  type ThinkingDepth,
} from '@shared/thinking'
import type { ThinkingParam } from './types'

// Resolve a stored choice into the directive sent to the model. undefined = the model can't think.
// effort (OpenAI / Gemini 3 / effort-capable Claude — Anthropic wire = output_config.effort) XOR
// budgetTokens (legacy Claude / Gemini 2.5); on Anthropic 4.6+ a tier pick rides WITH adaptive
// (adaptive + effort), while the explicit 'adaptive' choice is adaptive alone (model self-budgets,
// upstream-default effort). No stored choice → the model's TOP tier (per-role default is "think as
// hard as possible"); a stale choice the model doesn't offer (binding re-pointed) clamps to its top
// tier instead of silently dropping thinking. 'max' is list-driven — it passes through only on models
// whose tier list contains it (Anthropic 4.6+); elsewhere it clamps to that model's own top tier.
export function resolveDepth(protocol: string, slug: string, depth: string | null | undefined): ThinkingParam | undefined {
  const knob = thinkingKnob(protocolFamily(protocol), slug)
  if (knob.kind === 'none') return undefined
  const choice = (depth || undefined) as ThinkingChoice | undefined
  const adaptive = knob.kind === 'effort' && !!knob.adaptiveOption
  if (choice === 'adaptive' && adaptive) return { adaptive: true }
  const tiers = knobDepths(knob)
  const want: ThinkingDepth = choice && choice !== 'adaptive' ? choice : tiers[tiers.length - 1]
  const eff = clampDepth(want, tiers)
  if (!eff) return undefined
  if (knob.kind === 'effort') return { ...(adaptive ? { adaptive: true } : {}), effort: eff as ThinkingParam['effort'] }
  const budget = knob.mapping[eff]
  return budget !== undefined ? { budgetTokens: budget } : undefined
}
