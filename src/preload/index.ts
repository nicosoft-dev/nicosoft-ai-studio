import { contextBridge, ipcRenderer } from 'electron'

// Typed bridge exposed to the renderer as `window.api`.
// Batch 0: only window controls (frameless window). DB / LLM / etc. land in later batches.
const api = {
  minimizeWindow: (): void => ipcRenderer.send('app:minimize'),
  maximizeWindow: (): void => ipcRenderer.send('app:maximize'),
  closeWindow: (): void => ipcRenderer.send('app:close')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (fallback when contextIsolation is off — not used in this app)
  window.api = api
}

export type Api = typeof api
