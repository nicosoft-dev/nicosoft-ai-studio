import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'

export interface ViewerImage {
  url: string
  name: string
}

// Full-screen image lightbox — Escape closes, ← / → step through the set. Reused by every message
// list. Controlled: the parent owns the open item set + index.
export function ImageViewer({
  items,
  index,
  onClose,
  onStep
}: {
  items: ViewerImage[]
  index: number
  onClose: () => void
  onStep: (delta: number) => void
}): ReactElement | null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onStep(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onStep(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStep])

  const cur = items[index]
  if (!cur) return null
  return (
    <div className="img-viewer" onClick={onClose}>
      <button className="iv-close" onClick={onClose} title="Close">
        <Icons.x size={18} />
      </button>
      {items.length > 1 ? (
        <button className="iv-nav left" onClick={(e) => { e.stopPropagation(); onStep(-1) }} title="Previous">
          <Icons.chevronLeft size={22} />
        </button>
      ) : null}
      <img className="iv-img" src={cur.url} alt={cur.name} onClick={(e) => e.stopPropagation()} />
      {items.length > 1 ? (
        <button className="iv-nav right" onClick={(e) => { e.stopPropagation(); onStep(1) }} title="Next">
          <Icons.chevronRight size={22} />
        </button>
      ) : null}
      {items.length > 1 ? <div className="iv-count">{index + 1} / {items.length}</div> : null}
    </div>
  )
}
