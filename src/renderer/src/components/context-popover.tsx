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

// Shade per part. CC derives its ladder from hsl lightness (+6 per step); that cannot port — Studio's
// tokens are oklch, whose L is PERCEPTUAL, so the three bases sit at wildly different heights and dark
// --warning (L 0.78) would hit the ceiling at the very first step. Fading toward the background instead
// keeps every base, theme and part-count separable, and it is what Studio's own --accent-soft/-softer
// already do. Free space is the remainder rather than a part, so it takes the faintest neutral — matching
// CC's actual intent, where Free space is the LARGEST slice yet drawn the palest: least important, least ink.
const shadeFor = (id: ContextPart, i: number): string =>
  id === 'free' ? 'var(--border-1)' : `color-mix(in oklab, var(--ctx-base) ${100 - 15 * i}%, transparent)`

/* — ContextParts: the stacked bar + its legend. Parts arrive biggest-first, so the heaviest gets the
     densest shade and the eye lands on what is actually filling the window. — */
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
  return (
    <>
      {/* Says "estimated" because it IS: the tool kit's share can only be priced locally — count_tokens
          rejects a body carrying it — so the parts are honest about not being a measurement. */}
      <div className="ctx-bar-note">{t('conv.ctxEstimated')}</div>
      <div className="ctx-bar" role="presentation">
        {shown.map((p, i) => (
          <span key={p.id} className="ctx-bar-seg" style={{ width: `${(p.tokens / max) * 100}%`, background: shadeFor(p.id, i) }} />
        ))}
      </div>
      <ul className="ctx-legend">
        {shown.map((p, i) => (
          <li key={p.id} className="ctx-legend-row">
            <span className="ctx-legend-dot" style={{ background: shadeFor(p.id, i) }} />
            <span className="ctx-legend-name">{label[p.id]}</span>
            <span className="ctx-legend-tok">{fmtContextTokens(p.tokens)}</span>
            <span className="ctx-legend-pct">{((p.tokens / max) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
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
              {/* the level class rides the popover ROOT too: it is portaled to <body>, so it inherits
                  nothing from the ring — this is what puts --ctx-base in scope for the panel. */}
              <div
                ref={menuRef}
                className={`ctx-pop ctx-${level}`}
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
                    <div className="ctx-pop-total">{summary}</div>
                    {breakdown ? <ContextParts breakdown={breakdown} /> : null}
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
