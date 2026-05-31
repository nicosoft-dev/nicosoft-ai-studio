import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'
import type { ImageAttachment } from '@/lib/image'

// Pending-image thumbnail strip above the textarea (56×56, hover-× to remove). Shared by every
// composer. Reuses the .cmp-attach-strip / .cmp-att-img / .cmp-att-x styles.
export function AttachmentStrip({
  items,
  onRemove
}: {
  items: ImageAttachment[]
  onRemove: (id: string) => void
}): ReactElement | null {
  if (items.length === 0) return null
  return (
    <div className="cmp-attach-strip">
      {items.map((a) => (
        <div className="cmp-att-img" key={a.id}>
          <img
            src={a.dataUrl}
            alt={a.name}
            style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-1)' }}
          />
          <button className="cmp-att-x" onClick={() => onRemove(a.id)} title="Remove">
            <Icons.x size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}
