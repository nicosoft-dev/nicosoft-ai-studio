/* — Reusable confirm dialog (e.g. delete a custom role) — */
import type { ReactElement } from 'react'
import { Modal } from '@/components/modal'
import { useT } from '@/stores/locale'

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}): ReactElement {
  const t = useT()
  return (
    <Modal
      title={title}
      onClose={onClose}
      className="confirm"
      foot={
        <>
          <div className="df-spacer" />
          <button className="btn ghost sm" onClick={onClose}>{t('common.cancel')}</button>
          <button className={'btn sm ' + (danger ? 'danger' : 'primary')} onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</button>
        </>
      }
    >
      <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.55, margin: 0 }}>{body}</p>
    </Modal>
  )
}
