import { ipcMain } from 'electron'
import * as endpointService from '../services/endpoint.service'
import type { EndpointInput } from './contracts'

// IPC boundary for endpoints — parse args, call the service, return. No SQL / repo / keychain here.
export function registerEndpointHandlers(): void {
  ipcMain.handle('endpoints:list', () => endpointService.list())
  ipcMain.handle('endpoints:add', (_e, input: EndpointInput) => endpointService.add(input))
  ipcMain.handle('endpoints:update', (_e, id: string, patch: Partial<EndpointInput>) =>
    endpointService.update(id, patch)
  )
  ipcMain.handle('endpoints:remove', (_e, id: string) => endpointService.remove(id))
  ipcMain.handle('endpoints:test', (_e, id: string) => endpointService.test(id))
}
