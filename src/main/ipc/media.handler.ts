import { ipcMain, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { readMediaFile } from '../media/storage'

// IPC boundary for generated media (designer's images). save() writes an nsai-media:// image to a
// user-chosen path — mirrors conversations:export (showSaveDialog → write). Returns the saved path,
// or null when the user cancels or the referenced media file is missing.
export function registerMediaHandlers(): void {
  ipcMain.handle('media:save', async (_e, url: string, suggestedName: string): Promise<string | null> => {
    const file = readMediaFile(url)
    if (!file) return null
    const ext = (file.mime.split('/')[1] || 'png').replace('jpeg', 'jpg')
    const hasExt = /\.[a-z0-9]+$/i.test(suggestedName ?? '')
    const result = await dialog.showSaveDialog({
      defaultPath: hasExt ? suggestedName : `${suggestedName || 'image'}.${ext}`,
      filters: [{ name: 'Image', extensions: [ext] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, file.buffer)
    return result.filePath
  })
}
