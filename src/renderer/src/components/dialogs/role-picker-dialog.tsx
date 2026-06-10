/* — Role picker for "New conversation": a 3-column grid of role cards (avatar · name · specialty).
   The sidebar's new-conversation button used to hard-jump to generalist; a new conversation in Studio
   is really "a new conversation WITH someone", so the user picks the someone. The CURRENT expert's card
   is highlighted and focused — Enter (or a click) starts right where you already are, so the common
   "restart with the same expert" stays two keystrokes. Disabled roles are filtered out by the caller. — */
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { Avatar } from '@/components/primitives'
import { Modal } from '@/components/modal'
import { useT } from '@/stores/locale'
import type { Expert } from '@/types'

export function RolePickerDialog({
  experts,
  currentId,
  onPick,
  onClose
}: {
  experts: Expert[]
  currentId: string
  onPick: (id: string) => void
  onClose: () => void
}): ReactElement {
  const t = useT()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    const i = Math.max(0, experts.findIndex((e) => e.id === currentId))
    refs.current[i]?.focus()
    // focus once on mount — afterwards the roving focus follows the arrow keys
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const move = (from: number, delta: number): void => {
    const to = from + delta
    if (to >= 0 && to < experts.length) refs.current[to]?.focus()
  }
  return (
    <Modal
      title={t('rolePicker.title')}
      onClose={onClose}
      className="role-picker-dialog"
      onDialogKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="role-picker-grid">
        {experts.map((e, i) => (
          <button
            key={e.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            className={'rp-card' + (e.id === currentId ? ' current' : '')}
            onClick={() => onPick(e.id)}
            onKeyDown={(ev) => {
              if (ev.key === 'ArrowRight') { ev.preventDefault(); move(i, 1) }
              else if (ev.key === 'ArrowLeft') { ev.preventDefault(); move(i, -1) }
              else if (ev.key === 'ArrowDown') { ev.preventDefault(); move(i, 3) }
              else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(i, -3) }
            }}
          >
            <Avatar expert={e} size={40} />
            <span className="rp-name">
              {e.name}
              {e.coordinator ? <span className="primary-tag">PRIMARY</span> : null}
            </span>
            <span className="rp-job">{e.specialty}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
