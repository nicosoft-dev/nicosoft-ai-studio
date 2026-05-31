import * as roleRepo from '../repos/role.repo'
import type { RoleBindingDto, RoleBindingInput, RoleStateDto } from '../ipc/contracts'

// Business layer for role bindings (endpoint/model/thinking) + per-role state (enabled / self-learning).
// Maps the repo rows to the renderer-facing DTOs. Never touches IPC; never writes SQL directly.

function toBindingDto(b: roleRepo.RoleBinding): RoleBindingDto {
  return { roleId: b.roleId, endpointId: b.endpointId, model: b.model, thinkingDepth: b.thinkingDepth }
}

function toStateDto(s: roleRepo.RoleState): RoleStateDto {
  return { roleId: s.roleId, enabled: s.enabled, selfLearningEnabled: s.selfLearningEnabled }
}

export function listBindings(): RoleBindingDto[] {
  return roleRepo.listBindings().map(toBindingDto)
}

export function setBinding(roleId: string, input: RoleBindingInput): RoleBindingDto {
  roleRepo.setBinding(roleId, {
    endpointId: input.endpointId ?? null,
    model: input.model ?? null,
    thinkingDepth: input.thinkingDepth ?? null
  })
  const b = roleRepo.getBinding(roleId)
  return b
    ? toBindingDto(b)
    : { roleId, endpointId: input.endpointId ?? null, model: input.model ?? null, thinkingDepth: input.thinkingDepth ?? null }
}

export function listStates(): RoleStateDto[] {
  return roleRepo.listStates().map(toStateDto)
}

export function setState(
  roleId: string,
  state: { enabled: boolean; selfLearningEnabled: boolean }
): RoleStateDto {
  roleRepo.setState(roleId, state)
  return { roleId, enabled: state.enabled, selfLearningEnabled: state.selfLearningEnabled }
}
