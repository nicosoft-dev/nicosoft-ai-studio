import { ipcMain } from 'electron'
import * as memoryRepo from '../repos/memory.repo'
import * as memoryService from '../services/memory.service'
import type { MemoryAddInput, MemoryUpdateInput, MemoryOnTurnInput } from './contracts'
import type { MemoryType } from '../repos/memory.repo'

// IPC boundary for memory: list/add/remove for the Memory UI, plus onTurn — the post-turn/explicit
// extraction trigger the renderer fires after each assistant reply. No SQL here.
export function registerMemoryHandlers(): void {
  ipcMain.handle('memory:list', () => memoryRepo.listAll())

  ipcMain.handle('memory:add', (_e, input: MemoryAddInput) => {
    const type: MemoryType =
      input.type === 'preference' || input.type === 'learning' ? input.type : 'fact'
    return memoryRepo.create({
      layer: input.layer === 'role' ? 'role' : 'shared',
      roleId: input.layer === 'role' ? (input.roleId ?? null) : null,
      type,
      content: input.content,
      source: 'user', // user-authored memory outranks auto-extracted on dedup
      tokens: Math.ceil(input.content.length / 4)
    })
  })

  ipcMain.handle('memory:update', (_e, input: MemoryUpdateInput) =>
    memoryRepo.update(input.id, { content: input.content, tokens: Math.ceil(input.content.length / 4) })
  )

  ipcMain.handle('memory:remove', (_e, id: string) => memoryRepo.remove(id))

  // Fire-and-forget from the renderer; runs the post-turn cadence + explicit cue in the backend.
  ipcMain.handle('memory:onTurn', (_e, ctx: MemoryOnTurnInput) => memoryService.onTurn(ctx))
}
