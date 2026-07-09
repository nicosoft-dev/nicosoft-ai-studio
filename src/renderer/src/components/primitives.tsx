// Shared primitives — recreated from the prototype's components.jsx.
import { Fragment, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from './icons'
import { STUDIO_DATA } from '@/data/studio-data'
import { useAnchoredMenu } from '@/lib/use-anchored-menu'
import type { Expert } from '@/types'

/* — Avatar: monogram in expert identity color — */
export function Avatar({
  expert,
  size = 28,
  you = false,
  streaming = false
}: {
  expert?: Expert | null
  size?: number
  you?: boolean
  streaming?: boolean
}): ReactElement {
  const fontSize = Math.round(size * 0.42)
  if (you) {
    const uname = (STUDIO_DATA.USER_PROFILE.name || '').trim()
    const label = uname ? uname[0].toUpperCase() : 'You'
    return (
      <div
        className={'avatar you' + (streaming ? ' streaming' : '')}
        style={{ width: size, height: size, fontSize: uname ? fontSize : Math.round(size * 0.3) }}
      >
        {label}
      </div>
    )
  }
  const letter = expert?.name[0] ?? '?'
  return (
    <div
      className={'avatar' + (streaming ? ' streaming' : '')}
      style={{ width: size, height: size, fontSize, '--av-color': expert?.color } as CSSProperties}
    >
      {letter}
    </div>
  )
}

/* — Avatar stack: overlapping expert monograms — */
export function AvatarStack({ ids, size = 26 }: { ids: string[]; size?: number }): ReactElement {
  const { EXPERT_BY_ID } = STUDIO_DATA
  return (
    <div className="avatar-stack" style={{ height: size }}>
      {ids.map((id, i) => (
        <span key={id} className="as-item" style={{ marginLeft: i === 0 ? 0 : -size * 0.34, zIndex: ids.length - i }}>
          <Avatar expert={EXPERT_BY_ID[id]} size={size} />
        </span>
      ))}
    </div>
  )
}

/* — Name chip: expert color text on low-opacity fill — */
export function NameChip({ expert, neutral = false }: { expert?: Expert | null; neutral?: boolean }): ReactElement {
  if (neutral) {
    const uname = (STUDIO_DATA.USER_PROFILE.name || '').trim()
    return <span className="name-chip neutral">{uname || 'You'}</span>
  }
  return (
    <span className="name-chip" style={{ '--chip-color': expert?.color } as CSSProperties}>
      {expert?.name}
    </span>
  )
}

/* — Health dot — */
export function HealthDot({ status }: { status: string }): ReactElement {
  const cls = ({ healthy: 'healthy', degraded: 'degraded', failing: 'failing', off: 'off' } as Record<string, string>)[status] || 'off'
  return <span className={'health-dot ' + cls} />
}

/* — Syntax highlighter (lightweight, Python + TSX) — */
/* — Dispatch badge for collaboration — */
export function DispatchBadge({ chain }: { chain: string[] }): ReactElement {
  const { EXPERT_BY_ID } = STUDIO_DATA
  const coordinator = EXPERT_BY_ID.coordinator
  return (
    <div className="dispatch">
      <span className="d-node d-lead">
        <span className="d-dot" style={{ background: coordinator.color }} /> {coordinator.name} · routing
      </span>
      {chain.map((id) => {
        const e = EXPERT_BY_ID[id]
        if (!e) return null // skip non-expert ids in the chain (e.g. a tool like 'studio_lens') — a badge must never crash on a stray id
        return (
          <Fragment key={id}>
            <span className="d-arrow">
              <Icons.arrowRight size={13} />
            </span>
            <span className="d-node">
              <span className="d-dot" style={{ background: e.color }} /> {e.name}
            </span>
          </Fragment>
        )
      })}
    </div>
  )
}

/* — small flat switch (one source: previously memory.tsx MemToggle + extensions.tsx Toggle) — */
export function Switch({ on, onClick, disabled, ariaLabel }: { on: boolean; onClick: () => void; disabled?: boolean; ariaLabel?: string }): ReactElement {
  return (
    <button
      className={'switch' + (on ? ' on' : '') + (disabled ? ' disabled' : '')}
      onClick={disabled ? undefined : onClick}
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      <span className="knob" />
    </button>
  )
}

/* — segmented control (one source: previously hand-written <div className="segmented"> in 8 places) — */
export interface SegmentedOption {
  v: string
  l: ReactNode
  disabled?: boolean
}
export function Segmented({
  options,
  value,
  onChange,
  className
}: {
  options: Array<string | SegmentedOption>
  value: string
  onChange: (v: string) => void
  className?: string
}): ReactElement {
  return (
    <div className={className ? `${className} segmented` : 'segmented'}>
      {options.map((o) => {
        const opt: SegmentedOption = typeof o === 'string' ? { v: o, l: o } : o
        return (
          <button key={opt.v} className={value === opt.v ? 'active' : ''} disabled={opt.disabled} onClick={() => onChange(opt.v)}>
            {opt.l}
          </button>
        )
      })}
    </div>
  )
}

/* — custom select (one source, replaces every native <select>): a native select pops the OS menu —
   outside the app theme entirely (macOS blue highlight, light chrome in dark mode) — so select-like
   controls render the same portaled .row-menu the app's other dropdowns use (ModelPicker / context
   menu visuals: .rm-item rows + a check on the current value). The portal + useAnchoredMenu keep the
   menu out of overflow-clipping ancestors (dialogs, table rows); .sm-float lifts it above the dialog
   overlay (z 100 — the base .row-menu z 61 would sink under it). The trigger takes an existing skin
   class (input / wf-cell / asg-filter-sel), so each call site keeps its current look. — */
export interface SelectMenuOption {
  value: string
  label: string
  disabled?: boolean
}
export function SelectMenu({
  value,
  options,
  onChange,
  disabled,
  className,
  mono
}: {
  value: string
  options: SelectMenuOption[]
  onChange: (v: string) => void
  disabled?: boolean
  className?: string // the trigger's visual skin (e.g. "input", "wf-cell", "asg-filter-sel")
  mono?: boolean // mono face for the label + options (model ids, param types)
}): ReactElement {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { menuRef, style } = useAnchoredMenu(open, triggerRef, 'down')
  const current = options.find((o) => o.value === value)
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={'sel-trigger' + (className ? ` ${className}` : '')}
        disabled={disabled}
        onClick={() => setOpen((s) => !s)}
      >
        <span className={'sel-label' + (mono ? ' cmp-mono' : '')}>{current?.label ?? value}</span>
        <Icons.chevronDown size={12} />
      </button>
      {open
        ? createPortal(
            <>
              <div className="menu-backdrop sm-float-bg" onClick={() => setOpen(false)} />
              <div ref={menuRef} className="row-menu sm-menu sm-float" style={style} onClick={(e) => e.stopPropagation()}>
                {options.length === 0 ? <div className="rm-empty">—</div> : null}
                {options.map((o) => (
                  <div
                    key={o.value}
                    className={'rm-item' + (o.value === value ? ' active' : '') + (o.disabled ? ' disabled' : '')}
                    onClick={() => {
                      if (o.disabled) return
                      onChange(o.value)
                      setOpen(false)
                    }}
                  >
                    <span className={mono ? 'cmp-mono' : undefined}>{o.label}</span>
                    {o.value === value ? <Icons.check size={13} /> : null}
                  </div>
                ))}
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )
}
