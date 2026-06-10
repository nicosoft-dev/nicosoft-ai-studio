/* — Reusable single-input prompt dialog (e.g. rename a conversation) — */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Modal } from '@/components/modal'
import { useT } from '@/stores/locale'

export function PromptDialog({
  title,
  initial,
  confirmLabel,
  placeholder,
  onConfirm,
  onClose
}: {
  title: string
  initial?: string
  confirmLabel: string
  placeholder?: string
  onConfirm: (value: string) => void
  onClose: () => void
}): ReactElement {
  const t = useT()
  const [value, setValue] = useState(initial ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const submit = (): void => {
    const v = value.trim()
    if (v) onConfirm(v)
    onClose()
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      className="confirm"
      foot={
        <>
          <div className="df-spacer" />
          <button className="btn ghost sm" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary sm" onClick={submit}>{confirmLabel}</button>
        </>
      }
    >
      <input
        ref={ref}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); else if (e.key === 'Escape') onClose() }}
      />
    </Modal>
  )
}
