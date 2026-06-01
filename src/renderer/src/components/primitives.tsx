// Shared primitives — recreated from the prototype's components.jsx.
import { Fragment, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Icons } from './icons'
import { STUDIO_DATA } from '@/data/studio-data'
import type { Block as BlockData, Expert, Segment as SegmentData } from '@/types'

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
export function highlight(code: string, lang: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const kw =
    lang === 'python'
      ? ['for', 'in', 'range', 'try', 'except', 'return', 'import', 'def', 'if', 'else', 'while', 'with', 'as', 'None', 'True', 'False', 'raise', 'from']
      : ['useEffect', 'const', 'let', 'var', 'return', 'new', 'function', 'if', 'else', 'throw', 'catch', 'await', 'async', 'import', 'export', 'from', 'void']
  const builtins =
    lang === 'python'
      ? ['session', 'time', 'sleep', 'get', 'ConnectionResetError', 'timeout']
      : ['AbortController', 'fetchUser', 'setUser', 'controller', 'signal', 'abort', 'name', 'then', 'catch', 'AbortError']

  return code
    .split('\n')
    .map((line) => {
      let commentIdx = -1
      if (lang === 'python') commentIdx = line.indexOf('#')
      else commentIdx = line.indexOf('//')
      let codePart = line
      let comment = ''
      if (commentIdx >= 0) {
        codePart = line.slice(0, commentIdx)
        comment = line.slice(commentIdx)
      }
      const parts = codePart.split(/(\"[^\"]*\"|'[^']*')/g)
      let out = parts
        .map((seg, i) => {
          if (i % 2 === 1) return `<span class="tok-str">${esc(seg)}</span>`
          let s = esc(seg)
          s = s.replace(/\b(\d+)\b/g, '<span class="tok-num">$1</span>')
          kw.forEach((k) => {
            s = s.replace(new RegExp('\\b(' + k + ')\\b', 'g'), '<span class="tok-kw">$1</span>')
          })
          builtins.forEach((b) => {
            s = s.replace(new RegExp('\\b(' + b + ')\\b', 'g'), '<span class="tok-bui">$1</span>')
          })
          return s
        })
        .join('')
      if (comment) out += `<span class="tok-com">${esc(comment)}</span>`
      return out
    })
    .join('\n')
}

export function CodeBlock({ lang, code }: { lang: string; code: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  const onCopy = (): void => {
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="lang">{lang}</span>
        <button className="copy-code" onClick={onCopy}>
          {copied ? <Icons.check size={12} /> : <Icons.copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlight(code, lang) }} />
      </pre>
    </div>
  )
}

/* — Designer generated-image card (CSS-rendered "poster") — */
export function GeneratedPoster(): ReactElement {
  return (
    <div className="image-card">
      <div className="img-frame" style={{ background: '#0a0a0f' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            textAlign: 'center',
            fontFamily: 'var(--mono)'
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: '0.35em', color: 'oklch(0.72 0.16 195)', fontWeight: 700 }}>INSERT COIN</div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 800,
              letterSpacing: '0.02em',
              lineHeight: 1.0,
              color: 'oklch(0.78 0.19 330)',
              textShadow: '0 0 1px oklch(0.78 0.19 330)'
            }}
          >
            GAME
            <br />
            NIGHT
          </div>
          <div style={{ width: 130, height: 2, background: 'oklch(0.7 0.18 60)' }} />
          <div style={{ fontSize: 13, letterSpacing: '0.18em', color: 'oklch(0.82 0.16 90)', fontWeight: 700 }}>FRIDAY · 8PM</div>
        </div>
      </div>
    </div>
  )
}

/* — Block renderer — */
export function Block({ block }: { block: BlockData }): ReactElement | null {
  switch (block.type) {
    case 'para':
      return <p dangerouslySetInnerHTML={{ __html: block.html || '' }} />
    case 'quote':
      return <div className="quote-de" dangerouslySetInnerHTML={{ __html: block.html || '' }} />
    case 'code':
      return <CodeBlock lang={block.lang || ''} code={block.code || ''} />
    case 'imagecard':
      return (
        <>
          <GeneratedPoster />
          <div className="image-actions">
            <button className="seg-action" style={{ opacity: 1, color: 'var(--text-3)' }}>
              <Icons.download size={13} /> Download
            </button>
            <button className="seg-action" style={{ opacity: 1, color: 'var(--text-3)' }}>
              <Icons.refresh size={13} /> Regenerate
            </button>
            <button className="seg-action" style={{ opacity: 1, color: 'var(--text-3)' }}>
              <Icons.sparkle size={13} /> Refine
            </button>
          </div>
        </>
      )
    default:
      return null
  }
}

/* — A full message segment — */
export function Segment({ seg }: { seg: SegmentData }): ReactElement {
  const { EXPERT_BY_ID } = STUDIO_DATA
  const isUser = seg.who === 'user'
  const expert = isUser ? null : EXPERT_BY_ID[seg.who]
  const segColor = isUser ? 'var(--border-2)' : seg.synthesis ? 'var(--accent)' : expert?.color

  return (
    <div className={'segment' + (isUser ? ' user' : '')} style={{ '--seg-color': segColor } as CSSProperties}>
      <div className="seg-head">
        <Avatar expert={expert} you={isUser} size={28} streaming={seg.streaming} />
        <div className="seg-meta">
          <NameChip expert={expert} neutral={isUser} />
          {seg.synthesis && <span className="synthesis-tag">synthesis</span>}
          {seg.model && <span className="model-tag">{seg.model}</span>}
        </div>
        {seg.ts && <span className="ts">{seg.ts}</span>}
      </div>
      <div className={'seg-body' + (isUser || seg.synthesis ? ' primary' : '')}>
        {seg.blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
        {seg.streaming && <span className="caret" />}
      </div>
      {!isUser && !seg.streaming && (
        <div className="seg-actions">
          <button className="seg-action">
            <Icons.copy size={13} /> Copy
          </button>
          <button className="seg-action">
            <Icons.refresh size={13} /> Regenerate
          </button>
          <button className="seg-action">
            <Icons.edit size={13} /> Edit
          </button>
          <button className="seg-action">
            <Icons.trash size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

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
