import type { ReactElement } from 'react'
import { Avatar } from '@/components/primitives'
import { STUDIO_DATA } from '@/data/studio-data'
import type { Expert } from '@/types'

// Centered welcome state for an empty conversation — big avatar + greeting + example chips. Shared by
// the regular conversation view and the Engineer agent view so every role's blank state looks the same.
export function EmptyState({ expert, onChip }: { expert: Expert; onChip: (c: string) => void }): ReactElement {
  const { GREETINGS } = STUDIO_DATA
  const g = GREETINGS[expert.id] || GREETINGS.generalist
  return (
    <div className="empty-state">
      <div className="empty-inner">
        <div className="big-avatar">
          <Avatar expert={expert} size={48} />
        </div>
        <div className="es-name">{expert.name}</div>
        <div className="es-greet">{g.greeting}</div>
        <div className="example-chips">
          {g.chips.map((c, i) => (
            <button className="example-chip" key={i} onClick={() => onChip(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
