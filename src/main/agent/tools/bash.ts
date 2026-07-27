// Bash tool — run a shell command in the project dir. Concurrency-safety = isReadOnly(command), so
// read-only commands parallelize and mutations serialize. Writes require permission. Read-only
// classification (quote-aware operator split, fail-closed on any write-capable construct) lives in
// ./bash-classifier.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { semanticNumber, semanticBoolean } from './semantic'
import type { AgentContext } from '../context'
import { buildTool } from '../tool'
import type { ToolResultBlock } from '../types'
import { baseHookPayload, hookContextFromAgent } from '../hooks/adapter'
import { runHooks } from '../hooks/engine'
import { clearHookEnvFiles, hasHookEnvSource, shellSourceHookEnvSnippet } from '../hooks/env-file'
import { fileWatchManager } from '../hooks/file-watch'
import { hookRegistry } from '../hooks/registry'
import { isReadOnlyCommand } from './bash-classifier'
import {
  GIT_BASH_GUIDANCE,
  findGitBashPath,
  killTree,
  planShellSpawn,
  posixPathToWindowsPath,
  shellPathsEqual,
  windowsPathToPosixPath,
} from '../shell-invocation'
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
  // CC §B.1.1: cwd follows wherever the shell's surviving `pwd` lands — there is NO allowed-root gate (Studio used
  // to confine cd to cwdRoot; that deviated from CC and is removed for fidelity). realpath it (the marker's pwd
  // resolves symlinks) and move BOTH cwd and the confinement root to it so subsequent file ops work at the new cwd;
  // an unresolvable path keeps the old cwd. setCwd persists cwd across turns (collab) / up the chain (solo); cwdRoot
  // is synced back by the loop's syncMutableContextState (solo) / the collab turn's finally.
  const resolved = await realpath(newCwd).catch(() => null)
  if (!resolved) return `Bash changed directory to ${newCwd}, which could not be resolved; Studio kept cwd at ${oldCwd}.`
  ctx.cwd = resolved
  ctx.cwdRoot = resolved
  ctx.setCwd?.(resolved)
  if (ctx.isSubAgent) return null
  await clearHookEnvFiles(ctx.sessionDir, ['cwdchanged', 'filechanged'])
  let watchPaths: string[] = []
  if (hookRegistry.hasAny('CwdChanged')) {
    const merged = await runHooks('CwdChanged', { ...baseHookPayload('CwdChanged', ctx), old_cwd: oldCwd, new_cwd: resolved }, hookContextFromAgent(ctx))
    for (const msg of merged.systemMessages) console.log(`[hooks:CwdChanged] ${msg}`)
    watchPaths = merged.watchPaths
  }
  if (ctx.convId) await fileWatchManager.rearmForCwdChange(ctx.convId, watchPaths, { cwd: resolved, sessionDir: ctx.sessionDir, roleId: ctx.roleId })
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
    // Windows without git-bash: a guided tool error (127 = command not found), not a crash — the model
    // relays the install instructions and the turn survives. Mirrors the Claude Desktop preflight.
    if (process.platform === 'win32' && !findGitBashPath()) {
      return { data: { stdout: '', stderr: GIT_BASH_GUIDANCE, code: 127, timedOut: false, signal: null } }
    }
    const markerDir = await mkdtemp(join(tmpdir(), `studio-cwd-${process.pid}-`))
    const markerPath = join(markerDir, `${randomUUID()}.pwd`)
    // git-bash's pwd/trap live in POSIX-path land — hand the marker over as /c/… on Windows.
    const markerPathForShell = process.platform === 'win32' ? windowsPathToPosixPath(markerPath) : markerPath
    const envPrelude = shellSourceHookEnvSnippet(ctx.sessionDir)
    const wrappedCommand = `STUDIO_CWD_MARKER=${shellQuote(markerPathForShell)}; trap 'pwd > "$STUDIO_CWD_MARKER"' EXIT; ${envPrelude} ${input.command}`
    return new Promise<{ data: BashOutput }>((resolve, reject) => {
      // POSIX: shell:true + detached — the child leads its own process group, so a timeout/abort can kill
      // the WHOLE tree (the shell + every grandchild it forked) via killTree(-pgid). Plain child.kill()
      // signals only the shell — that is exactly how `find /` once survived the 120s timeout and hung a
      // build for 17min. win32: explicit git-bash `bash.exe -c` (cmd.exe cannot parse bash syntax) with
      // windowsHide so no console window pops over the GUI, and NO detached (on Windows detached means
      // "give the child its own console window"; the tree is reaped by taskkill /T, not process groups).
      const plan = planShellSpawn(wrappedCommand)
      const child = spawn(plan.file, plan.args, {
        ...plan.options,
        cwd: ctx.cwd,
        signal: ctx.signal,
        env: process.platform === 'win32' ? { ...process.env, SHELL: plan.file } : process.env,
      })
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
      // Kill the whole tree: POSIX group signal (negative pid) with single-pid fallback; Windows
      // taskkill /T /F. Shared with the scheduler's command steps.
      const killGroup = (sig: NodeJS.Signals): void => {
        if (child.pid == null) return
        killTree(child.pid, sig)
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
          const rawFinalCwd = (await readFile(markerPath, 'utf-8').catch(() => '')).trim()
          // git-bash's pwd emits /c/Users/… — convert back before comparing/realpathing as a native path.
          const finalCwd = rawFinalCwd && process.platform === 'win32' ? posixPathToWindowsPath(rawFinalCwd) : rawFinalCwd
          const completed = !timedOut && signal == null
          if (completed && finalCwd && !shellPathsEqual(finalCwd, ctx.cwd)) {
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
