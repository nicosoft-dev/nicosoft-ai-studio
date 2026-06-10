// Custom window controls for Windows/Linux, drawn at the macOS traffic-light position (top-left, inside
// the 78px strip .sidebar-header already reserves). titleBarStyle:'hidden' means those platforms get NO
// native controls; the native titleBarOverlay was rejected — it pins them top-RIGHT and paints its own
// background strip. macOS renders nothing here (real traffic lights). Fixed + high z so every view
// (shell, settings, onboarding) has them; the buttons are no-drag islands inside the drag regions.
//
// MOUNT ORDER MATTERS: this component must be the LAST child of .window. Chromium builds the OS drag
// region by walking the layout tree in DOCUMENT order, applying union (drag) / difference (no-drag)
// sequentially — z-index is irrelevant. Mounted before the content, our no-drag holes get punched
// first and .sidebar-header/.topbar's drag rect then covers them back: the buttons render on top but
// every click hit-tests as the caption (drag) at the OS level, so they were unclickable on Windows'
// main view while working on onboarding (which has no overlapping drag region).

import type { ReactElement } from 'react'

const isMac = window.api.platform === 'darwin'

export function WindowControls(): ReactElement | null {
  if (isMac) return null
  return (
    <div className="win-controls">
      <button className="wc-btn" title="Minimize" onClick={() => window.api.minimizeWindow()}>
        <svg width="11" height="11" viewBox="0 0 11 11"><line x1="1.5" y1="5.5" x2="9.5" y2="5.5" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
      <button className="wc-btn" title="Maximize" onClick={() => window.api.maximizeWindow()}>
        <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1.8" y="1.8" width="7.4" height="7.4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
      <button className="wc-btn wc-close" title="Close" onClick={() => window.api.closeWindow()}>
        <svg width="11" height="11" viewBox="0 0 11 11"><path d="M2 2 L9 9 M9 2 L2 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
      </button>
    </div>
  )
}
