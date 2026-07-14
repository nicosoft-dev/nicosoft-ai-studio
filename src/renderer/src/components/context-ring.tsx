/* ============================================================
   NicoSoft AI Studio — composer context indicator (ring)
   ============================================================ */
import type { ReactElement } from 'react'
import { fmtContextTokens } from '@/lib/format'

// 12px outer: r=5 + strokeWidth 2 lands the stroke's outer edge exactly on the viewBox. The progress is a
// dash the length of the whole circumference, pulled back by strokeDashoffset — so offset 0 = full ring.
const RING_PX = 12
const RING_R = 5
const CIRC = 2 * Math.PI * RING_R

export type ContextLevel = 'normal' | 'warning' | 'critical'

// Thresholds only (75 / 90) are borrowed from Claude Code; the COLORS are Studio's own semantic tokens.
// The returned name doubles as a CSS class (`ctx-normal` …) that resolves --ctx-base to the matching
// token, so the level→colour mapping lives in one place rather than being repeated per consumer.
export function contextLevel(pct: number): ContextLevel {
  return pct >= 90 ? 'critical' : pct >= 75 ? 'warning' : 'normal'
}

export interface ContextReading {
  pct: number // 0–100, CLAMPED — drives the ring sweep and the level
  level: ContextLevel
  summary: string // "43.1K / 1M (4%)" — tooltip + a11y label
}

// The window's fill, in the two shapes the UI needs. `pct` is clamped so an over-limit prompt reads as a
// full critical ring instead of sweeping past 360°, while the SUMMARY drops the percentage entirely in
// that case: a prompt bigger than the window has no honest "% of window used" (mirrors CC, which would
// rather show tokens alone than "127%").
export function readContext(used: number, max: number): ContextReading {
  const pct = max > 0 ? Math.round(100 * Math.max(0, Math.min(1, used / max))) : 0
  const over = max > 0 && used > max
  const summary = `${fmtContextTokens(used)} / ${fmtContextTokens(max)}${over ? '' : ` (${pct}%)`}`
  return { pct, level: contextLevel(pct), summary }
}

/* — ContextRing: the 12px sweep itself — a pure function of the reading. The interaction (the trigger
     button + its popover) lives in context-popover.tsx. — */
export function ContextRing({ pct, level }: { pct: number; level: ContextLevel }): ReactElement {
  return (
    <svg
      className={`ctx-ring ctx-${level}`}
      width={RING_PX}
      height={RING_PX}
      viewBox={`0 0 ${RING_PX} ${RING_PX}`}
      aria-hidden
    >
      <circle className="ctx-ring-track" cx={6} cy={6} r={RING_R} fill="none" strokeWidth={2} />
      <circle
        className="ctx-ring-fill"
        cx={6}
        cy={6}
        r={RING_R}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={CIRC}
        strokeDashoffset={CIRC * (1 - pct / 100)}
      />
    </svg>
  )
}
