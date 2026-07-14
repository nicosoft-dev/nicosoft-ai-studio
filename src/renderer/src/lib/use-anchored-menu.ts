import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

export type MenuPlacement = 'right' | 'up' | 'up-right' | 'down'

// Anchors a portaled .row-menu as position:fixed to its trigger so it escapes every overflow-clipping
// ancestor — the bug where a row's three-dot menu / model picker got cut off at the .ext-list card edge
// (.ext-list overflow:hidden, with .ext-body scroll behind it). The menu must be rendered through a portal
// to document.body; spread `style` onto the .row-menu and attach `menuRef`. Sizing uses offsetWidth/Height
// (layout size, transform-free) so the dialog-in scale(0.985) animation can't skew the measurement.
//
// Placement is the preferred side: 'right' opens below, right-aligned to the trigger; 'up' opens above
// (composer menus); 'up-right' opens above AND right-aligned (a wide panel hung off a trigger that already
// sits at the right edge — left-aligning it would only get clamped back, landing it past the trigger);
// 'down' opens below, left-aligned. Each auto-flips when its side lacks room, then the result is clamped
// into the viewport. Repositions on scroll/resize while open.
// right/bottom MUST be neutralized here: while hidden we measure the menu, and the base CSS (.row-menu.right
// sets right:0, .row-menu.up sets bottom:calc(100%+6px)) would otherwise stretch it edge-to-edge and yield a
// bogus offsetWidth/Height, throwing off the computed anchor.
const HIDDEN: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 'auto', bottom: 'auto', visibility: 'hidden' }

export function useAnchoredMenu(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  placement: MenuPlacement
): { menuRef: RefObject<HTMLDivElement | null>; style: CSSProperties } {
  const menuRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>(HIDDEN)

  useLayoutEffect(() => {
    if (!open) {
      setStyle(HIDDEN)
      return
    }
    const place = (): void => {
      const t = triggerRef.current?.getBoundingClientRect()
      const menu = menuRef.current
      if (!t || !menu) return
      const mw = menu.offsetWidth
      const mh = menu.offsetHeight
      const gap = 6
      const margin = 8
      let top: number
      if (placement === 'up' || placement === 'up-right') {
        const above = t.top - mh - gap
        top = above >= margin ? above : t.bottom + 4 // flip down when there's no room above
      } else {
        const below = t.bottom + 4
        top = below + mh <= window.innerHeight - margin ? below : Math.max(margin, t.top - mh - gap) // flip up
      }
      // 'right' / 'up-right' align the menu's right edge to the trigger's; the others align left edges.
      let left = placement === 'right' || placement === 'up-right' ? t.right - mw : t.left
      left = Math.max(margin, Math.min(left, window.innerWidth - mw - margin))
      top = Math.max(margin, Math.min(top, window.innerHeight - mh - margin))
      // Return the SAME object when nothing moved so React bails out of the re-render: the ResizeObserver
      // below fires once on observe(), and this keeps that from costing a render — and makes a
      // place→render→place loop impossible even if some future caller's size did depend on its position.
      // The `visibility` test keeps the initial hidden→placed transition from being swallowed when the
      // computed anchor happens to be 0,0.
      setStyle((prev) =>
        prev.visibility === undefined && prev.top === top && prev.left === left
          ? prev
          : { position: 'fixed', top, left, right: 'auto', bottom: 'auto' }
      )
    }
    place()
    // An open menu can change HEIGHT on its own (a collapsible section, a filtered list). The 'up'
    // placements pin the TOP edge and neutralize `bottom`, so a shrink moves the bottom edge — the very
    // edge that must hug the trigger — leaving the menu floating away from it. The CSS path
    // (.row-menu.up { bottom: calc(100% + 6px) }) is bottom-anchored and immune; computing `top` here
    // forfeits that, so re-place whenever the box resizes. place() only writes top/left, which cannot
    // resize the box — no loop. (Static menus just take the one no-op fire from observe().)
    const ro = new ResizeObserver(place)
    if (menuRef.current) ro.observe(menuRef.current)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, placement, triggerRef])

  return { menuRef, style }
}
