/* ============================================================
   Workspace · Files viewer — a wide overlay (NOT crammed into the narrow drawer,
   design §3 decision ②). Reads via the confined fs:readForView and renders by
   kind: code → Shiki, .md → react-markdown, image → <img>, binary/oversize →
   an empty state with Reveal / Open-with-default fallbacks.
   ============================================================ */
import { useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '@/components/icons'
import { CodeBlock, Markdown } from '@/components/markdown'
import { useT } from '@/stores/locale'
import { toast } from '@/stores/toast'
import type { FsReadForView } from '@/lib/api'

const MD_RE = /\.(md|markdown|mdx)$/i
const MIN_W = 420
const MIN_H = 280

export function FileViewer({
  cwd,
  relPath,
  name,
  onClose
}: {
  cwd: string
  relPath: string
  name: string
  onClose: () => void
}): ReactElement {
  const t = useT()
  const [data, setData] = useState<FsReadForView | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null)
    setError(false)
    window.api.fs
      .readForView(cwd, relPath)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [cwd, relPath])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openDefault = (): void => {
    void window.api.fs.openDefault(cwd, relPath).catch(() => toast.error(t('files.openFailed')))
  }
  const reveal = (): void => {
    void window.api.fs.reveal(cwd, relPath).catch(() => toast.error(t('files.revealFailed')))
  }

  // Floating, draggable, resizable window — an independent window, NOT a modal: no backdrop, no
  // outside-click dismiss (close only via ✕ / Esc). Position + size live here, centered on open.
  const [rect, setRect] = useState(() => {
    const w = Math.min(1100, Math.round(window.innerWidth * 0.82))
    const h = Math.min(860, Math.round(window.innerHeight * 0.82))
    return {
      x: Math.max(20, Math.round((window.innerWidth - w) / 2)),
      y: Math.max(20, Math.round((window.innerHeight - h) / 2)),
      w,
      h
    }
  })

  const startDrag = (e: React.MouseEvent): void => {
    if ((e.target as HTMLElement).closest('.fv-actions')) return // header buttons aren't a drag handle
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const base = { x: rect.x, y: rect.y }
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent): void => {
      const nx = base.x + (ev.clientX - sx)
      const ny = base.y + (ev.clientY - sy)
      // keep a grabbable strip of the window on screen
      setRect((r) => ({
        ...r,
        x: Math.min(Math.max(nx, 24 - r.w), window.innerWidth - 80),
        y: Math.min(Math.max(ny, 0), window.innerHeight - 36)
      }))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const base = { w: rect.w, h: rect.h }
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent): void => {
      setRect((r) => ({
        ...r,
        w: Math.max(MIN_W, Math.min(base.w + (ev.clientX - sx), window.innerWidth - r.x - 8)),
        h: Math.max(MIN_H, Math.min(base.h + (ev.clientY - sy), window.innerHeight - r.y - 8))
      }))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  let body: ReactElement
  if (error) body = <div className="ws-empty">{t('files.viewFailed')}</div>
  else if (!data) body = <div className="ws-empty">{t('files.loading')}</div>
  else if (data.kind === 'image') body = <img className="fv-img" src={data.dataUrl} alt={name} />
  else if (data.kind === 'text')
    body = MD_RE.test(name) ? (
      <div className="fv-md">
        <Markdown>{data.text ?? ''}</Markdown>
      </div>
    ) : (
      // `bare` drops CodeBlock's own container + lang/Copy head (the inner box); .fv-code adds line numbers.
      <div className="fv-code">
        <CodeBlock lang={data.lang ?? 'text'} code={data.text ?? ''} bare />
      </div>
    )
  else
    body = (
      <div className="fv-unpreview">
        <div className="ws-empty">{data.kind === 'toolarge' ? t('files.tooLarge') : t('files.binary')}</div>
        <div className="fv-unpreview-actions">
          <button className="fv-btn" onClick={reveal}>{t('files.reveal')}</button>
          <button className="fv-btn" onClick={openDefault}>{t('files.openDefault')}</button>
        </div>
      </div>
    )

  return createPortal(
    <div className="fv-window" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <div className="fv-head" onMouseDown={startDrag}>
        <span className="fv-name" title={relPath}>{name}</span>
          <div className="fv-actions">
            {data?.kind === 'text' && (
              <button
                className="icon-btn"
                title={t('files.copy')}
                onClick={() => {
                  void navigator.clipboard.writeText(data.text ?? '')
                  toast.success(t('files.copied'))
                }}
              >
                <Icons.copy size={15} />
              </button>
            )}
            <button className="icon-btn" title={t('files.reveal')} onClick={reveal}>
              <Icons.folder size={15} />
            </button>
            <button className="icon-btn" title={t('files.openDefault')} onClick={openDefault}>
              <Icons.externalLink size={15} />
            </button>
            <button className="icon-btn" title={t('common.close')} onClick={onClose}>
              <Icons.x size={16} />
            </button>
          </div>
        </div>
      <div className="fv-body">{body}</div>
      <div className="fv-resize" onMouseDown={startResize} title={t('files.resize')} />
    </div>,
    document.body
  )
}
