// Capability scope block shared by the MCP and Skill dialogs (previously duplicated verbatim, down to
// a doubled mcp.*/skill.* locale family — now the single scope.* family): All experts / Specific
// segmented pick, the per-role pills with the no-agent marker, and the agent-scope note.

import type { ReactElement } from 'react'
import { Avatar, Segmented } from './primitives'
import { STUDIO_DATA } from '@/data/studio-data'
import { roleHasAgent } from '@/stores/chat'
import { useT } from '@/stores/locale'

export function ScopePicker({
  scopeAll,
  onScopeAll,
  scopeRoles,
  onToggleRole
}: {
  scopeAll: boolean
  onScopeAll: (all: boolean) => void
  scopeRoles: string[]
  onToggleRole: (id: string) => void
}): ReactElement {
  const { EXPERTS } = STUDIO_DATA
  const t = useT()
  return (
    <div>
      <label className="field-label">{t('scope.label')}</label>
      <Segmented
        options={[
          { v: 'all', l: t('scope.allExperts') },
          { v: 'specific', l: t('scope.specific') }
        ]}
        value={scopeAll ? 'all' : 'specific'}
        onChange={(v) => onScopeAll(v === 'all')}
      />
      {!scopeAll ? (
        <div className="mcp-scope-roles">
          {EXPERTS.map((e) => {
            const noAgent = !roleHasAgent(e.id)
            return (
              <button
                key={e.id}
                className={'scope-pick' + (scopeRoles.includes(e.id) ? ' on' : '')}
                onClick={() => onToggleRole(e.id)}
                title={noAgent ? t('scope.agentScopeNote') : undefined}
              >
                <Avatar expert={e} size={16} /> {e.name}
                {noAgent ? <span className="scope-noagent">{t('scope.noAgent')}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
      <div className="scope-note">{t('scope.agentScopeNote')}</div>
    </div>
  )
}
