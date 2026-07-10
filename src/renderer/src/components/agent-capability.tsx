/* — Agent capability editor (custom roles): the switch row + the capability-group grid. ONE component
     for both hosts — the role editor dialog (local state, saved on Create/Save) and the role PROFILE
     page (edit-in-place, every toggle persists immediately). Keys mirror main's CUSTOM_AGENT_TOOL_GROUPS;
     write⇒read (read locked while write is on) and the first-enable default seeding live HERE so the two
     hosts can't drift. — */
import type { ReactElement } from 'react'
import { Icons } from '@/components/icons'
import { Switch } from '@/components/primitives'
import { useT } from '@/stores/locale'

export const AGENT_GROUPS = ['read', 'write', 'web', 'code', 'schedule', 'bash', 'image', 'pdf', 'task'] as const
export const DEFAULT_AGENT_GROUPS: readonly string[] = ['read', 'write', 'web', 'code', 'schedule']

export interface AgentCapabilityState {
  agent: boolean
  groups: Record<string, boolean>
}

// Stored tools → checked-group state (labels that aren't group keys — pre-agent checkbox relics — drop).
export function groupsFromTools(tools: readonly string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const t of tools) if ((AGENT_GROUPS as readonly string[]).includes(t)) out[t] = true
  return out
}

// Checked-group state → the tools array to persist (stable AGENT_GROUPS order).
export function toolsFromGroups(groups: Record<string, boolean>): string[] {
  return AGENT_GROUPS.filter((k) => groups[k])
}

// Pure transition for the switch: first-ever enable seeds the safe default kit; a re-enable keeps
// whatever was checked before (switching off never clears the selection).
export function toggleAgentState(s: AgentCapabilityState): AgentCapabilityState {
  const agent = !s.agent
  const groups = agent && !Object.values(s.groups).some(Boolean) ? Object.fromEntries(DEFAULT_AGENT_GROUPS.map((k) => [k, true])) : s.groups
  return { agent, groups }
}

// Pure transition for a group click: write ⇒ read (checking write force-checks read; read stays locked
// while write is on — an agent that edits files but can't read them can't complete a single edit loop).
export function toggleGroupState(groups: Record<string, boolean>, key: string): Record<string, boolean> {
  if (key === 'read' && groups.read && groups.write) return groups
  const next = { ...groups, [key]: !groups[key] }
  if (key === 'write' && next.write) next.read = true
  return next
}

export function AgentCapabilityEditor({
  agent,
  groups,
  onChange
}: {
  agent: boolean
  groups: Record<string, boolean>
  onChange: (next: AgentCapabilityState) => void
}): ReactElement {
  const tr = useT()
  const groupLabels: Record<string, string> = {
    read: tr('roleEditor.groupRead'),
    write: tr('roleEditor.groupWrite'),
    web: tr('roleEditor.groupWeb'),
    code: tr('roleEditor.groupCode'),
    schedule: tr('roleEditor.groupSchedule'),
    bash: tr('roleEditor.groupBash'),
    image: tr('roleEditor.groupImage'),
    pdf: tr('roleEditor.groupPdf'),
    task: tr('roleEditor.groupTask')
  }
  return (
    <>
      <div className="agent-cap-row">
        <div className="acr-text">
          <span>{tr('roleEditor.agentDesc')}</span>
          <span className="acr-hint">{tr('roleEditor.agentModelHint')}</span>
        </div>
        <Switch on={agent} onClick={() => onChange(toggleAgentState({ agent, groups }))} ariaLabel={tr('roleEditor.agentTitle')} />
      </div>
      {agent && (
        <div className="agent-groups">
          {AGENT_GROUPS.map((k) => {
            const checked = !!groups[k]
            const locked = k === 'read' && !!groups.write
            return (
              <div
                className={'tool-check' + (locked ? ' locked' : '')}
                key={k}
                onClick={() => onChange({ agent, groups: toggleGroupState(groups, k) })}
                title={locked ? tr('roleEditor.readRequired') : undefined}
              >
                <span className={'checkbox' + (checked ? ' on' : '')}>{checked && <Icons.check size={12} />}</span>
                <span className="tc-label">{groupLabels[k]}</span>
                {k === 'bash' && <span className="tc-warn"><Icons.alert size={11} /> {tr('roleEditor.groupBashWarn')}</span>}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
