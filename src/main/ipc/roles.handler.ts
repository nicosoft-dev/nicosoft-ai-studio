import { ipcMain } from 'electron'
import * as rolesService from '../services/roles.service'
import * as convRepo from '../repos/conversation.repo'
import { abortConversationRuns } from './coordinator.handler'
import type { CustomRoleCreateDto, CustomRoleUpdateDto, RoleBindingInput } from './contracts'

// IPC boundary for role bindings + states + custom roles — parse args, call the service, return.
// No SQL/repo here.
export function registerRoleHandlers(): void {
  ipcMain.handle('roles:bindings:list', () => rolesService.listBindings())
  ipcMain.handle('roles:binding:set', (_e, roleId: string, input: RoleBindingInput) =>
    rolesService.setBinding(roleId, input)
  )
  ipcMain.handle('roles:states:list', () => rolesService.listStates())
  ipcMain.handle('roles:state:set', (_e, roleId: string, patch: { enabled?: boolean; selfLearningEnabled?: boolean }) =>
    rolesService.setState(roleId, patch)
  )
  ipcMain.handle('roles:remove', (_e, roleId: string) => {
    // Stop the role's LIVE runs before the cascade deletes their conversations (same stop-then-delete
    // discipline as project deletion) — a streaming agent must not keep burning tokens into deleted rows.
    for (const convId of convRepo.listIdsByRole(roleId)) abortConversationRuns(convId)
    rolesService.remove(roleId)
  })
  // Custom roles — list / create / update (delete reuses roles:remove since it cascades the same way).
  ipcMain.handle('roles:custom:list', () => rolesService.listCustom())
  ipcMain.handle('roles:custom:create', (_e, input: CustomRoleCreateDto) => rolesService.createCustom(input))
  ipcMain.handle('roles:custom:update', (_e, id: string, patch: CustomRoleUpdateDto) =>
    rolesService.updateCustom(id, patch)
  )
}
