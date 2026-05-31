import { ipcMain } from 'electron'
import * as rolesService from '../services/roles.service'
import type { RoleBindingInput } from './contracts'

// IPC boundary for role bindings + states — parse args, call the service, return. No SQL/repo here.
export function registerRoleHandlers(): void {
  ipcMain.handle('roles:bindings:list', () => rolesService.listBindings())
  ipcMain.handle('roles:binding:set', (_e, roleId: string, input: RoleBindingInput) =>
    rolesService.setBinding(roleId, input)
  )
  ipcMain.handle('roles:states:list', () => rolesService.listStates())
  ipcMain.handle('roles:state:set', (_e, roleId: string, patch: { enabled?: boolean; selfLearningEnabled?: boolean }) =>
    rolesService.setState(roleId, patch)
  )
  ipcMain.handle('roles:remove', (_e, roleId: string) => rolesService.remove(roleId))
}
