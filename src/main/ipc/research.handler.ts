// Research IPC — the `/research <question>` entry. `research:run` starts a deep-research run in the background
// (the service appends + drives the research card over the conv:card channel and returns synchronously);
// `research:stop` aborts an in-flight run. No run-event channel: the card IS the live surface (service.ts).

import { ipcMain } from 'electron'
import * as researchService from '../services/research/service'
import type { RunResearchInput } from '../services/research/service'

export function registerResearchHandlers(): void {
  ipcMain.handle('research:run', (_e, input: RunResearchInput) => researchService.run(input))
  ipcMain.handle('research:stop', (_e, runId: string) => researchService.stop(runId))
}

export { abortAllResearchRuns } from '../services/research/service'
