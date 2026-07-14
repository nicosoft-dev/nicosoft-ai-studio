/* ============================================================
   NicoSoft AI Studio — context indicator popover ("Context window")
   ============================================================ */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '@/components/icons'
import { useAnchoredMenu } from '@/lib/use-anchored-menu'
import { useT } from '@/stores/locale'
import { ContextRing, readContext } from '@/components/context-ring'

/* — ContextIndicator: the composer's readout — the ring, and the panel it opens.
     Studio PUSHES its context size (count_tokens rides back with each turn into chat.contextTokens), so
     unlike CC — which pulls on hover/focus through react-query — there is nothing to refetch here and no
     throttle to build. The ring is always the context percentage; there is no plan-usage mode. — */
export function ContextIndicator({ used, max }: { used: number; max: number }): ReactElement | null {
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
