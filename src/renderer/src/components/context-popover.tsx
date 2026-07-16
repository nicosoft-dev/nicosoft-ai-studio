/* ============================================================
   NicoSoft AI Studio — context indicator popover ("Context window")
   ============================================================ */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '@/components/icons'
import { fmtContextTokens } from '@/lib/format'
import { useAnchoredMenu } from '@/lib/use-anchored-menu'
import { useT } from '@/stores/locale'
import type { ContextBreakdown, ContextPart } from '@/stores/chat'
import { ContextRing, readContext } from '@/components/context-ring'
import { COMPRESS_RATIO } from '../../../shared/compression'

// One FIXED colour per part, not a ladder — this is Claude Code's CLI approach, and the reason for it is
// that a ladder cannot survive a real palette. CC's desktop build derives shades from a base
// (hsl(from base h s min(85, l+6i))); ported to Studio's oklch tokens that collapses, because oklch's L is
// perceptual and dark --warning sits at 0.78 with 0.07 of headroom. The alpha ladder that replaced it kept
// every step distinct in code but not to the eye: four 15% steps on an 8px legend swatch read as one
// colour. Discrete hues are legible at any size and any part count. Every value is an existing token — no
// new colour is introduced. Free space stays the faintest neutral: it is the remainder, and CC draws it
// palest even though it is the LARGEST slice — least important, least ink.
// Every part colour is OPAQUE and a different hue. Both properties are load-bearing: --accent-soft looked
// like a second colour but is literally `color-mix(--accent 18%, transparent)` — an alpha of --accent, i.e.
// the ladder again, and translucent, so the same part rendered differently over the bar's track than over
// the popover's background. Free space alone stays translucent: it is the empty part of the track, not a
// part with a colour.
const PART_COLOR: Record<ContextPart, string> = {
  tools: 'var(--accent)', // blue-violet
  system: 'var(--success)', // green — picked as a HUE from the palette, not as "success"
  memory: 'var(--warning)', // amber
  messages: 'var(--text-3)', // mid grey (opaque; --text-4 is dimmer than --border-2 in light mode)
  free: 'var(--border-1)', // the remainder — faintest neutral, as CC draws it despite it being the largest
}

/* — ContextParts: the stacked bar + its legend. Parts arrive biggest-first. — */
function ContextParts({ breakdown }: { breakdown: ContextBreakdown }): ReactElement | null {
  const t = useT()
  const label: Record<ContextPart, string> = {
    system: t('conv.ctxSystem'),
    memory: t('conv.ctxMemory'),
    tools: t('conv.ctxTools'),
    messages: t('conv.ctxMessages'),
    free: t('conv.ctxFree'),
  }
  // Percentages are of the WINDOW, not of the sum of the parts: the track IS the window, so Free space is
  // literally what's left of it and the widths need no normalising. A window of 0 makes that meaningless
  // (and every width infinite) — draw nothing rather than a lie.
  const max = breakdown.max
  if (max <= 0) return null
  const shown = breakdown.parts.filter((p) => p.tokens > 0)
  // Over-window state (total > max — a declared window smaller than the prompt actually is; reachable via
  // a mis-declared custom endpoint, a stale catalog window, or a small-window model under a heavy tool
  // kit). Free space is 0 and silently filtered above, so without its own row the deficit had NO
  // expression: the legend percentages quietly summed past 100 and the bar overflowed its track. Here the
  // denominator becomes the PROMPT (parts sum back to 100, the bar is the prompt's composition), the
  // deficit gets an explicit error-coloured "Over window" row (+tokens, and how far past the window in
  // window-%), and the header goes error-coloured. Under the window: denom === max, nothing changes.
  // Both HEAVY verdicts below stand only on an ANCHORED total (the server's own price): the cold-start
  // rough tier over-counts openai-protocol tool kits ~2x, and a verdict of "over the window" or "folding
  // cannot help" built on that would be confidently wrong exactly when it looks most alarming.
  const over = breakdown.anchored ? Math.max(0, breakdown.total - max) : 0
  // Normalising the bar is plain rendering correctness — segments must never overflow the track, anchored
  // or not — so the denominator ignores the anchored gate even though the Over row itself respects it.
  const denom = Math.max(max, breakdown.total)
  // The dead-end diagnosis: folding removes only Messages — System prompt / System tools / Auto-memory
  // survive every compaction. Once those alone reach the compaction trigger (COMPRESS_RATIO·window), no
  // fold can get back under it: auto compaction stops (compression.service's floor guard) and /compact
  // cannot help either. Without this line the panel shows a full window, the user runs /compact, nothing
  // improves, and there is no way to tell WHY (dogfood 2026-07-15: a 40K window under a 40.4K
  // system+tools floor). Stated as an always-true fact derived from the same parts the panel already
  // shows — not a readback of main's in-memory guard state, which a restart would clear. Two extra guards
  // keep it honest: the tools part is a RESIDUAL (it absorbs the whole gap between the anchored total and
  // the rough per-part probes), so the verdict also requires Messages itself to be small — if Messages
  // alone exceeds the window share a fold could free, folding obviously CAN help and no residual error
  // may claim otherwise.
  const irreducible = breakdown.parts.reduce((s, p) => (p.id === 'messages' || p.id === 'free' ? s : s + p.tokens), 0)
  const messagesPart = breakdown.parts.find((p) => p.id === 'messages')?.tokens ?? 0
  const floorLocked =
    breakdown.anchored && irreducible >= max * COMPRESS_RATIO && messagesPart <= max * (1 - COMPRESS_RATIO)
  return (
    <>
      {/* "Estimated" because the parts are differenced off the up-front count while the ring reads the live
          measured usage — the two are not meant to add up. CC labels its own panel the same way. */}
      <div className="ctx-bar-note">{t('conv.ctxEstimated')}</div>
      <div className="ctx-bar" role="presentation">
        {shown.map((p) => (
          <span
            key={p.id}
            className="ctx-bar-seg"
            // A real part must never round away to nothing: at a 1M window, Messages is routinely <0.01%
            // and would vanish while its legend row still claims tokens. CC solves this the same way
            // (Math.max(1, …) square per non-free part). Free space takes no floor — it IS the remainder.
            style={{ width: `${(p.tokens / denom) * 100}%`, minWidth: p.id === 'free' ? undefined : 2, background: PART_COLOR[p.id] }}
          />
        ))}
      </div>
      <ul className="ctx-legend">
        {shown.map((p) => (
          <li key={p.id} className="ctx-legend-row">
            <span className="ctx-legend-dot" style={{ background: PART_COLOR[p.id] }} />
            <span className="ctx-legend-name">{label[p.id]}</span>
            <span className="ctx-legend-tok">{fmtContextTokens(p.tokens)}</span>
            <span className="ctx-legend-pct">{((p.tokens / denom) * 100).toFixed(1)}%</span>
          </li>
        ))}
        {over > 0 ? (
          <li className="ctx-legend-row">
            <span className="ctx-legend-dot" style={{ background: 'var(--error)' }} />
            <span className="ctx-legend-name over">{t('conv.ctxOver')}</span>
            <span className="ctx-legend-tok over">+{fmtContextTokens(over)}</span>
            {/* of the WINDOW on purpose: "+1.2%" reads as "how far past the window", not a share of the prompt */}
            <span className="ctx-legend-pct">+{((over / max) * 100).toFixed(1)}%</span>
          </li>
        ) : null}
      </ul>
      {floorLocked ? <div className="ctx-floor-note">{t('conv.ctxFloorNote')}</div> : null}
    </>
  )
}

/* — ContextIndicator: the composer's readout — the ring, and the panel it opens.
     Studio PUSHES its context size (count_tokens rides back with each turn into chat.contextTokens), so
     unlike CC — which pulls on hover/focus through react-query — there is nothing to refetch here and no
     throttle to build. The ring is always the context percentage; there is no plan-usage mode. — */
export function ContextIndicator({ used, max, breakdown }: { used: number; max: number; breakdown?: ContextBreakdown }): ReactElement | null {
  const t = useT()
  const [open, setOpen] = useState(false)
  // Lives with the composer (so it outlasts a close/reopen) but is never written to storage — a panel this
  // small has nothing worth persisting across restarts.
  const [expanded, setExpanded] = useState(true)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Right-aligned: the ring lives at the toolbar's right edge, so a left-aligned panel would only be
  // clamped back by the viewport and land to the RIGHT of the ring, hanging off the composer.
  const { menuRef, style } = useAnchoredMenu(open, triggerRef, 'up-right')

  // Losing the window (endpoint unbound, catalog not loaded yet) renders the whole indicator away below.
  // `return null` is not an unmount, so without this `open` would survive: the panel would vanish and then
  // pop back unbidden the moment a window is known again, and its key listener would idle on in between.
  useEffect(() => {
    if (max <= 0) setOpen(false)
  }, [max])

  // Escape closes and returns focus to the ring — the backdrop covers pointer dismissal.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (max <= 0) return null // no known window → nothing honest to draw
  const { pct, level, summary } = readContext(used, max)
  // The panel's header reads the SAME number its parts were differenced from, so the two always add up.
  // The ring keeps `used` — the live measured usage, which is what "how full is my window" really means,
  // and which the API overwrites every turn. Pointing the header at `used` instead put two sources one line
  // apart: the parts summed to 30.4K under a header reading 40.2K. Claude Code avoids the clash by deriving
  // its header FROM the parts (its `used` is their sum) — same principle, applied at the seam we have.
  const panelSummary = breakdown ? readContext(breakdown.total, breakdown.max).summary : summary
  // Over the window (see ContextParts): the header number is the loudest place to say so. Same source as
  // the summary it colours — breakdown when present (anchored totals only, like every heavy verdict),
  // the live ring reading otherwise (server usage, anchored by nature).
  const panelOver = breakdown ? breakdown.anchored && breakdown.total > breakdown.max : used > max

  return (
    <>
      <button
        ref={triggerRef}
        className="ctx-ring-btn"
        title={summary}
        aria-label={t('conv.ctxRing', { summary })}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((s) => !s)}
      >
        <ContextRing pct={pct} level={level} />
      </button>
      {open
        ? createPortal(
            <>
              <div className="menu-backdrop" onClick={() => setOpen(false)} />
              <div
                ref={menuRef}
                className="ctx-pop"
                style={style}
                role="dialog"
                aria-label={t('conv.ctxUsage')}
                onClick={(e) => e.stopPropagation()}
              >
                <button className="ctx-pop-head" aria-expanded={expanded} onClick={() => setExpanded((s) => !s)}>
                  <span className={'ctx-pop-caret' + (expanded ? ' open' : '')}>
                    <Icons.chevronRight size={12} />
                  </span>
                  <span className="ctx-pop-title">{t('conv.ctxWindow')}</span>
                </button>
                {expanded ? (
                  <div className="ctx-pop-body">
                    <div className={'ctx-pop-total' + (panelOver ? ' over' : '')}>{panelSummary}</div>
                    {/* No breakdown yet (no measured turn this app session, or /compact cleared it): the
                        click must still answer — show the total and say when the parts will appear,
                        instead of a dead ring or a silently bare panel ("点了没反应" feedback). */}
                    {breakdown ? <ContextParts breakdown={breakdown} /> : <div className="ctx-pop-note">{t('conv.ctxNoBreakdown')}</div>}
                  </div>
                ) : null}
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )
}
