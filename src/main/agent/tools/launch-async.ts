// launch_async tool (C3 §6.3) — launch a READ-ONLY long-running command/script in the BACKGROUND as an
// AsyncRegistry handle (kind:'process'), returning its id immediately (non-blocking). The agent reports it
// started, keeps coordinating, then await_async-es the handle for the output. COLLAB-ONLY (ctx.async is wired
// by agent-collab). For a MUTATING command use Bash (synchronous, gated); for a long-lived server use
// start_service. Read-only keeps it safe to run unattended in the background (the same class Bash auto-allows),
// so no per-command approval prompt is needed for a detached process.
//
// This is the collab expert's real launch→await_async entry. The other §6.3 categories are intentionally NOT
// wired this round: panel (collab implementers have no panel_examine — 批3; the consolidated review is a
// synchronous coordinator step), service (start_service is already non-blocking/background), e2e (synchronous;
// native async would mean reworking the e2e tools), subagent (collab has no agent_spawn). They already have a
// synchronous/background form or no collab consumer, so launch_async covers the genuine gap (a detached script).

import { spawn } from 'node:child_process'
import { z } from 'zod'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'
import { isReadOnlyCommand } from './bash-classifier'

const inputSchema = z.strictObject({
  command: z.string().describe('A READ-ONLY shell command / script to run in the background (e.g. a long analysis / check / probe run).'),
  description: z.string().optional().describe('Short label of what it does (5-10 words), shown on the handle.'),
})

const MAX_CAP = 1_000_000 // cap captured output so a chatty background command can't balloon memory

export const launchAsyncTool = buildTool({
  name: 'launch_async',
  inputSchema,
  prompt: () =>
    'Launch a READ-ONLY long-running command/script in the BACKGROUND and get an async handle id immediately ' +
    '(non-blocking). Report it started, keep coordinating with teammates, then call await_async on the handle to ' +
    'collect its output. For a MUTATING command use Bash (synchronous, gated); for a long-lived server/dev process ' +
    'use start_service. Available in a collaboration only.',
  isReadOnly: () => true, // read-only command only (enforced below) — no mutation, safe detached
  isConcurrencySafe: () => true,
  async call(input, ctx) {
    if (!ctx.async) throw new Error('launch_async is only available in a collaboration.')
    if (!isReadOnlyCommand(input.command)) {
      throw new Error('launch_async runs READ-ONLY commands only. Use Bash (gated, synchronous) for a mutating command, or start_service for a long-lived process.')
    }
    const cwd = ctx.cwd
    const label = input.description?.trim() || input.command.slice(0, 60)
    const handle = ctx.async.launch('process', label, (signal) =>
      new Promise<string>((resolve) => {
        // node spawn honours { signal } — an aborted session (T3) kills the detached process.
        const child = spawn('bash', ['-lc', input.command], { cwd, signal })
        let out = ''
        const cap = (d: Buffer): void => { if (out.length < MAX_CAP) out += d.toString() }
        child.stdout?.on('data', cap)
        child.stderr?.on('data', cap)
        child.on('close', (code) => resolve(`[exit ${code ?? 'null'}]\n${out.slice(-8000)}`))
        child.on('error', (e) => resolve(`[spawn error] ${e instanceof Error ? e.message : String(e)}`))
      })
    )
    return { data: `Launched ${handle.id} (background: ${label}). Call await_async(["${handle.id}"]) to collect its output.` }
  },
  mapResult: stringResult,
})

function stringResult(out: string, toolUseId: string): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: toolUseId, content: out }
}
