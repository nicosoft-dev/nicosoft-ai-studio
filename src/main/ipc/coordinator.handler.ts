// Coordinator orchestrator over IPC. `coordinator:run` starts a routed turn (single or pipeline) and returns its
// streamId; events arrive on `coordinator:dispatch` (chain announced once after route) / `coordinator:step:start`
// (per step begin) / `coordinator:delta` (per step text token) / `coordinator:step:done` (per step finish), then
// terminal `coordinator:done` or `coordinator:error`. `coordinator:stop` aborts. This handler owns stream lifecycle
// (id + AbortController + sender lifetime cleanup); the service does the orchestration.

import { ipcMain, type WebContents } from 'electron'
import { ulid } from 'ulid'
import * as coordinatorService from '../services/coordinator.service'
import { LlmError } from '../llm/types'
import type {
  CoordinatorRunInputDto,
  CoordinatorDispatchEvent,
  CoordinatorStepStart,
  CoordinatorStepDelta,
  CoordinatorStepDone,
  CoordinatorDoneDto,
  CoordinatorErrorDto
} from './contracts'

const streams = new Map<string, { controller: AbortController; sender: WebContents }>()

export function registerCoordinatorHandlers(): void {
  ipcMain.handle('coordinator:run', (e, input: CoordinatorRunInputDto): { streamId: string } => {
    const streamId = ulid()
    const controller = new AbortController()
    const sender = e.sender
    streams.set(streamId, { controller, sender })

    // If the renderer goes away mid-stream, abort so SSE readers + fetch handles unwind instead of
    // hanging. Covers window close, render-process crash, and page reload — same pattern as agent.handler.
    const onGone = (): void => controller.abort()
    sender.once('destroyed', onGone)
    sender.once('render-process-gone', onGone)
    sender.once('did-start-loading', onGone)

    const send = (channel: string, data: unknown): void => {
      if (!sender.isDestroyed()) sender.send(channel, data)
    }

    void coordinatorService
      .run(
        input,
        {
          onDispatch: (chain, reason) => {
            const ev: CoordinatorDispatchEvent = { streamId, chain, reason }
            send('coordinator:dispatch', ev)
          },
          onStepStart: (roleId, dispatch, model) => {
            const ev: CoordinatorStepStart = { streamId, roleId, dispatch, model }
            send('coordinator:step:start', ev)
          },
          onDelta: (roleId, text) => {
            const ev: CoordinatorStepDelta = { streamId, roleId, text }
            send('coordinator:delta', ev)
          },
          onStepDone: (roleId, text, inputTokens) => {
            const ev: CoordinatorStepDone = { streamId, roleId, text, inputTokens }
            send('coordinator:step:done', ev)
          }
        },
        controller.signal
      )
      .then((r) => {
        const ev: CoordinatorDoneDto = { streamId, inputTokens: r.inputTokens }
        send('coordinator:done', ev)
      })
      .catch((err: unknown) => {
        const code = err instanceof LlmError ? err.code : 'unknown'
        const message = err instanceof Error ? err.message : String(err)
        const ev: CoordinatorErrorDto = { streamId, code, message }
        send('coordinator:error', ev)
      })
      .finally(() => {
        if (!sender.isDestroyed()) {
          sender.removeListener('destroyed', onGone)
          sender.removeListener('render-process-gone', onGone)
          sender.removeListener('did-start-loading', onGone)
        }
        streams.delete(streamId)
      })

    return { streamId }
  })

  ipcMain.handle('coordinator:stop', (_e, streamId: string) => {
    streams.get(streamId)?.controller.abort()
    streams.delete(streamId)
  })
}
