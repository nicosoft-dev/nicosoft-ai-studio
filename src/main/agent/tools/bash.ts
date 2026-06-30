// Bash tool — run a shell command in the project dir. Concurrency-safety = isReadOnly(command), so
// read-only commands parallelize and mutations serialize. Writes require permission. Read-only
// classification (quote-aware operator split, fail-closed on any write-capable construct) lives in
// ./bash-classifier.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { semanticNumber, semanticBoolean } from './semantic'
import type { AgentContext } from '../context'
import { confineReal } from '../confine'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'
import { baseHookPayload, hookContextFromAgent } from '../hooks/adapter'
import { runHooks } from '../hooks/engine'
import { clearHookEnvFiles, hasHookEnvSource, shellSourceHookEnvSnippet } from '../hooks/env-file'
import { fileWatchManager } from '../hooks/file-watch'
import { hookRegistry } from '../hooks/registry'
import { isReadOnlyCommand } from './bash-classifier'
import { assertBgIsolationWriteAllowed, bgIsolationWriteBlock } from './write-guard'

const inputSchema = z.object({
  command: z.string().describe('The shell command to run'),
  timeout_ms: semanticNumber(z.number().int().positive().optional()).describe('Timeout in ms (default 120000, clamped to 600000 max)'),
  timeout: semanticNumber(z.number().int().positive().optional()).describe('Alias for timeout_ms (milliseconds)'),
  run_in_background: semanticBoolean(z.boolean().optional()).describe('Ignored — Bash runs synchronously; use start_service for a long-running background process'),
  description: z
    .string()
    .optional()
    .describe('Clear, concise description of what this command does in active voice, 5-10 words, shown to the user (e.g. "Run the typecheck", "List files in src")'),
})

const DEFAULT_TIMEOUT = 120_000
const MAX_TIMEOUT = 600_000 // upper clamp — a runaway timeout would hang the turn indefinitely
const KILL_GRACE = 5_000
// Capture cap — generous so the verdict (usually at the END of test/build output) survives. The result
// layer (persistLargeResult, maxResultSizeChars below) then stores the full output to disk and shows a
// head+TAIL preview. A small head-only cap here would amputate the tail before that ever ran.
const MAX_OUTPUT = 2 * 1024 * 1024

interface BashOutput {
  stdout: string
  stderr: string
  code: number
  timedOut: boolean
  signal: NodeJS.Signals | null
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

async function fireCwdChanged(ctx: AgentContext, oldCwd: string, newCwd: string): Promise<string | null> {
  const root = ctx.cwdRoot ?? oldCwd
  const confined = await confineReal(root, newCwd).catch(() => null)
  if (!confined) return `Bash changed directory to ${newCwd}, which is outside the allowed root ${root}; Studio kept cwd at ${oldCwd}.`
  ctx.cwd = confined
  ctx.setCwd?.(confined)
  if (ctx.isSubAgent) return null
  await clearHookEnvFiles(ctx.sessionDir, ['cwdchanged', 'filechanged'])
  let watchPaths: string[] = []
  if (hookRegistry.hasAny('CwdChanged')) {
    const merged = await runHooks('CwdChanged', { ...baseHookPayload('CwdChanged', ctx), old_cwd: oldCwd, new_cwd: confined }, hookContextFromAgent(ctx))
    for (const msg of merged.systemMessages) console.log(`[hooks:CwdChanged] ${msg}`)
    watchPaths = merged.watchPaths
  }
  if (ctx.convId) await fileWatchManager.rearmForCwdChange(ctx.convId, watchPaths, { cwd: confined, sessionDir: ctx.sessionDir, roleId: ctx.roleId })
  return null
}

export const bashTool = buildTool<typeof inputSchema, BashOutput>({
  name: 'Bash',
  inputSchema,
  prompt: () =>
    'Run a shell command in the project directory. Returns combined stdout/stderr and the exit code. ' +
    'Prefer the dedicated Read/Grep/Glob tools over cat/grep/find where possible.',
  isReadOnly: (input, ctx) => isReadOnlyCommand(input.command) && (!ctx || !hasHookEnvSource(ctx.sessionDir)),
  isConcurrencySafe: (input, ctx) => isReadOnlyCommand(input.command) && (!ctx || !hasHookEnvSource(ctx.sessionDir)),
  isDestructive: (input) => !isReadOnlyCommand(input.command),
  checkPermissions: async (input, ctx) => {
    const bgBlock = !isReadOnlyCommand(input.command) ? bgIsolationWriteBlock(ctx) : null
    if (bgBlock) return { behavior: 'deny', message: bgBlock }
    return isReadOnlyCommand(input.command) && !hasHookEnvSource(ctx.sessionDir)
      ? { behavior: 'allow' }
      : { behavior: 'ask', message: `Run: ${input.command}` }
  },
  maxResultSizeChars: 30_000,
  async call(input, ctx) {
    if (!isReadOnlyCommand(input.command)) assertBgIsolationWriteAllowed(ctx)
    const markerDir = await mkdtemp(join(tmpdir(), `studio-cwd-${process.pid}-`))
    const markerPath = join(markerDir, `${randomUUID()}.pwd`)
    const envPrelude = shellSourceHookEnvSnippet(ctx.sessionDir)
    const wrappedCommand = `STUDIO_CWD_MARKER=${shellQuote(markerPath)}; trap 'pwd > "$STUDIO_CWD_MARKER"' EXIT; ${envPrelude} ${input.command}`
    return new Promise<{ data: BashOutput }>((resolve, reject) => {
      // detached: the child becomes its own process-group leader, so a timeout/abort can kill the WHOLE
      // tree (the shell + every grandchild it forked) via process.kill(-pgid). Plain child.kill() signals
      // only the shell — a command that forks (globs, pipes, a background server) leaves the real worker
      // orphaned and still running. That is exactly how `find /` survived the 120s timeout and hung a
      // build for 17min: the timeout killed the shell while the find kept scanning the whole disk.
      const child = spawn(wrappedCommand, { shell: true, cwd: ctx.cwd, signal: ctx.signal, detached: true })
      let stdout = ''
      let stderr = ''
      let truncated = false
      let timedOut = false
      // Append with a hard cap, marking truncation instead of silently dropping later chunks.
      const append = (buf: string, chunk: Buffer): string => {
        if (buf.length >= MAX_OUTPUT) {
          truncated = true
          return buf
        }
        return (buf + chunk.toString()).slice(0, MAX_OUTPUT)
      }
      // Kill the whole process group (negative pid). Fall back to the single child if the group send
      // fails (already-exited, or a platform without process groups).
      const killGroup = (sig: NodeJS.Signals): void => {
        if (child.pid == null) return
        try {
          process.kill(-child.pid, sig)
        } catch {
          try {
            child.kill(sig)
          } catch {
            /* already gone */
          }
        }
      }
      const timeout = Math.min(input.timeout_ms ?? input.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
      const termTimer = setTimeout(() => {
        timedOut = true
        killGroup('SIGTERM')
      }, timeout)
      // Escalate to SIGKILL if the group ignores SIGTERM, else the promise never settles and the agent
      // loop awaits forever.
      const killTimer = setTimeout(() => killGroup('SIGKILL'), timeout + KILL_GRACE)
      // A caller abort (turn cancel) must reap the whole tree too — the spawn signal only kills the shell.
      const onAbort = (): void => killGroup('SIGKILL')
      ctx.signal?.addEventListener('abort', onAbort, { once: true })
      const cleanup = (): void => {
        clearTimeout(termTimer)
        clearTimeout(killTimer)
        ctx.signal?.removeEventListener('abort', onAbort)
      }
      child.stdout?.on('data', (d: Buffer) => {
        stdout = append(stdout, d)
      })
      child.stderr?.on('data', (d: Buffer) => {
        stderr = append(stderr, d)
      })
      child.on('error', (err) => {
        cleanup()
        killGroup('SIGKILL')
        void rm(markerDir, { recursive: true, force: true })
        reject(err)
      })
      child.on('close', async (code, signal) => {
        cleanup()
        try {
          const finalCwd = (await readFile(markerPath, 'utf-8').catch(() => '')).trim()
          const completed = !timedOut && signal == null
          if (completed && finalCwd && finalCwd !== ctx.cwd) {
            const warning = await fireCwdChanged(ctx, ctx.cwd, finalCwd).catch((err) => `Studio could not persist Bash cwd: ${err instanceof Error ? err.message : String(err)}`)
            if (warning) stderr += `${stderr ? '\n' : ''}${warning}`
          }
        } finally {
          await rm(markerDir, { recursive: true, force: true }).catch(() => undefined)
        }
        if (truncated) stdout += '\n[output truncated at 2MB — re-run narrowed (head/tail/grep) to see more]'
        resolve({ data: { stdout, stderr, code: code ?? -1, timedOut, signal: signal ?? null } })
      })
    })
  },
  mapResult(out, toolUseId): ToolResultBlock {
    const parts: string[] = []
    if (out.stdout) parts.push(out.stdout.trimEnd())
    if (out.stderr) parts.push(`[stderr]\n${out.stderr.trimEnd()}`)
    if (out.timedOut) parts.push('[command timed out]')
    else if (out.signal) parts.push(`[killed by signal ${out.signal}]`)
    else if (out.code !== 0) parts.push(`[exit code: ${out.code}]`)
    // is_error only for abnormal termination (timeout/signal). A normal non-zero exit (failing test,
    // grep-no-match=1, diff-differs=1) is informative, not an error.
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: parts.join('\n') || '(no output)',
      is_error: out.timedOut || out.signal != null,
    }
  },
})
