import { ipcMain } from 'electron'
import * as analyticsService from '../services/analytics.service'
import type { AnalyticsSummary } from './contracts'

// Local analytics for Overview › Stats. Pull-on-open (the renderer re-fetches when the tab mounts); a single
// synchronous aggregation over the local DB + today's transcripts — small enough to compute on demand.
export function registerAnalyticsHandlers(): void {
  ipcMain.handle('analytics:summary', (): AnalyticsSummary => analyticsService.getSummary())
}
