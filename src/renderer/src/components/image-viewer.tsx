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
  onStep,
  onDownload,
  onRefine
}: {
  items: ViewerImage[]
  index: number
  onClose: () => void
  onStep: (delta: number) => void
  onDownload: (img: ViewerImage) => void
  onRefine?: (img: ViewerImage) => void
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
      <div className="iv-actions" onClick={(e) => e.stopPropagation()}>
        {onRefine ? (
          <button className="iv-action" onClick={() => onRefine(cur)} title="Refine — describe a change and regenerate">
            <Icons.sparkle size={15} /> Refine
          </button>
        ) : null}
        <button className="iv-action" onClick={() => onDownload(cur)} title="Download">
          <Icons.download size={15} /> Download
        </button>
        <button className="iv-action iv-icon-only" onClick={onClose} title="Close">
          <Icons.x size={17} />
        </button>
      </div>
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
