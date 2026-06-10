// The standard dialog shell every modal previously hand-rolled: .overlay backdrop (mousedown closes) >
// .dialog (stops propagation) > .dialog-head (title + ×) > .dialog-body > optional .dialog-foot.
// DOM/classes are exactly the hand-written shape, so the existing dialog CSS applies unchanged.
// Non-standard shells (CommandPalette's .cmdk, projects' EventDetailModal with its bare <pre> body)
// stay hand-rolled on purpose — forcing them through this would change their DOM.

import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { Icons } from './icons'

export function Modal({
  title,
  onClose,
  children,
  foot,
  className,
  onDialogKeyDown
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  // Rendered inside .dialog-foot; omit for foot-less dialogs (e.g. the role picker).
  foot?: ReactNode
  // Extra class(es) on .dialog — 'wide', 'confirm', 'role-picker-dialog'.
  className?: string
  // Key handling on the dialog element itself (the role picker's Escape-to-close).
  onDialogKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
}): ReactElement {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className={className ? `dialog ${className}` : 'dialog'}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="dialog-head">
          <span className="dh-title">{title}</span>
          <button className="icon-btn" onClick={onClose}>
            <Icons.x size={16} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {foot !== undefined && <div className="dialog-foot">{foot}</div>}
      </div>
    </div>
  )
}
