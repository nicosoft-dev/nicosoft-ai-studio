/* ============================================================
   NicoSoft AI Studio — @-mention expert picker (at-mention-expert-picker-design §3.4)
   The GUI twin of the `/` slash palette (command-palette.tsx): type `@` at the start of a message in a
   coordinator conversation and this floats a picker of the experts this conversation has been talking to.
   Pure presentation — the composer owns the state, matching, and the pick handler; this only renders +
   forwards the pick. Mirrors CommandPalette exactly (listbox / option / onMouseDown-preventDefault) so the
   textarea keeps focus through the pick.
   ============================================================ */
import type { ReactElement } from 'react'
import { useT } from '@/stores/locale'

export interface MentionCandidate {
  id: string
  name: string
  color: string
  disabled?: boolean // disabled/undispatchable now — listed dimmed, still pickable (server gives an actionable error)
}

export function MentionPalette({
  matches,
  index,
  onPick
}: {
  matches: MentionCandidate[]
  index: number
  onPick: (c: MentionCandidate) => void
}): ReactElement | null {
  const t = useT()
  if (!matches.length) return null
  return (
    <div className="mention-palette" role="listbox">
      {matches.map((c, i) => (
        <div
          key={c.id}
          role="option"
          aria-selected={i === index}
          className={'mention-row' + (i === index ? ' active' : '') + (c.disabled ? ' disabled' : '')}
          title={c.disabled ? t('conv.mentionUnavailable', { name: c.name }) : undefined}
          // onMouseDown + preventDefault (not onClick) so the textarea keeps focus through the pick.
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(c)
          }}
        >
          <span className="mention-dot" style={{ background: c.color }} />
          <span className="mention-name">{c.name}</span>
          {c.disabled ? <span className="mention-tag">{t('conv.mentionUnavailableTag')}</span> : null}
        </div>
      ))}
    </div>
  )
}
