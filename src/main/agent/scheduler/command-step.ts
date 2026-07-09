// Command-step executor (design doc §3.2) — a direct spawn, no agent/model/tokens. Shell mode hands the
// command string to the user's LOGIN shell (`-lc`: an Electron GUI process does not inherit the user's
// PATH — the login shell re-derives it, same root cause as the code_execution venv fix). Program mode
// spawns the executable + args verbatim — no shell parsing, so paths with spaces are safe by construction
// and there is no injection surface. The child gets its own process GROUP (posix detached / Windows
// taskkill /T) so a timeout or chain abort kills grandchildren too, not just the shell.
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import type { TaskStep } from '../../ipc/contracts'

const DEFAULT_TIMEOUT_SEC = 600
const STREAM_CAP = 64 * 1024 // per-stream rolling tail — enough for prior piping without unbounded memory
const KILL_GRACE_MS = 5000 // after a kill, how long to wait for 'close' before force-settling the promise

export interface CommandResult {
  ok: boolean // exit 0, not timed out, not aborted
  exitCode: number | null // null when the process died to a signal / never spawned
  output: string // stdout (+ labeled stderr), tail-capped — becomes the next step's prior
  timedOut: boolean
  aborted: boolean // the chain's signal fired (Stop button / chain abort) — distinct from a plain failure
}

// Keep the LAST `cap` characters of a growing string — the tail is where errors and summaries live. Only
// re-slice once the buffer runs past 2× the cap so a chatty line-buffered process (many small chunks) pays
// an amortized O(1) copy per byte instead of copying the whole cap on every chunk. Shared with the engine's
// persisted-tail capping (tailCap).
export function keepTail(buf: string, add: string, cap = STREAM_CAP): string {
  const s = buf + add
  return s.length > cap * 2 ? s.slice(s.length - cap) : s
}

// Final trim to exactly the cap (keepTail may hold up to 2×). Also the engine's per-step outputTail helper.
export function tailCap(s: string, cap = STREAM_CAP): string {
  const t = s.trim()
  return t.length > cap ? t.slice(t.length - cap) : t
}

// Resolve the shell invocation for `shell` mode. An explicit pick that doesn't exist on this platform
// (cmd on macOS, zsh on Windows) falls back to the platform default rather than failing the step.
function shellInvocation(step: TaskStep): { cmd: string; argv: string[] } {
  const command = step.command ?? ''
  if (process.platform === 'win32') {
    if (step.shell === 'powershell') return { cmd: 'powershell.exe', argv: ['-NoProfile', '-Command', command] }
    return { cmd: process.env.COMSPEC || 'cmd.exe', argv: ['/d', '/s', '/c', command] }
  }
  const explicit =
    step.shell === 'zsh' ? '/bin/zsh' : step.shell === 'bash' ? '/bin/bash' : step.shell === 'sh' ? '/bin/sh' : undefined
  const cmd = explicit ?? process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return { cmd, argv: ['-lc', command] }
}

// Kill the whole process tree. Posix: the child is its own group leader (detached), so signalling -pid
// reaches every descendant. Windows: taskkill /T walks the tree — its spawn failures surface as an async
// 'error' event, so we attach a no-op listener (a bare spawn with no listener would crash the main process
// on ENOENT/EPERM).
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      tk.on('error', () => {}) // best-effort: an unspawnable taskkill must not throw out of the event loop
    } catch {
      /* already gone */
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

export function runCommandStep(step: TaskStep, taskCwd: string | undefined, signal?: AbortSignal): Promise<CommandResult> {
  const mode = step.mode ?? 'shell'
  const inv = mode === 'program' ? { cmd: step.program?.trim() ?? '', argv: step.args ?? [] } : shellInvocation(step)
  const empty = mode === 'program' ? !inv.cmd : !(step.command ?? '').trim()
  if (empty) {
    return Promise.resolve({ ok: false, exitCode: null, output: mode === 'program' ? 'No program path set.' : 'No command set.', timedOut: false, aborted: false })
  }
  // Never spawn into an already-aborted chain (Stop pressed while an earlier step ran): starting the
  // process only to SIGKILL it microseconds later lets its first side effects run. Refuse up front.
  if (signal?.aborted) {
    return Promise.resolve({ ok: false, exitCode: null, output: '[stopped before the command started]', timedOut: false, aborted: true })
  }
  const cwd = step.stepCwd?.trim() || taskCwd?.trim() || homedir()
  // Validate the timeout: a hand-edited scheduled_tasks.json (a documented path) or a bad IPC payload can
  // carry a non-numeric / non-positive value; Math.max(1, NaN) is NaN → setTimeout(NaN) fires at ~1ms and
  // kills every run instantly. Fall back to the default unless it's a finite positive number.
  const sec = step.timeoutSec
  const timeoutMs = (typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? sec : DEFAULT_TIMEOUT_SEC) * 1000
  const env = { ...process.env, ...(step.env ?? {}) }

  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let timedOut = false
    let settled = false
    let graceTimer: ReturnType<typeof setTimeout> | undefined

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(inv.cmd, inv.argv, {
        cwd,
        env,
        detached: process.platform !== 'win32', // own process group → killTree(-pid) reaches grandchildren
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      // Synchronous spawn throw (e.g. malformed args from a hand-edited store) — settle as a failure, not
      // an unhandled rejection, so the chain records a step summary for it.
      resolve({ ok: false, exitCode: null, output: `spawn failed: ${e instanceof Error ? e.message : String(e)}`, timedOut: false, aborted: signal?.aborted === true })
      return
    }

    const finish = (ok: boolean, exitCode: number | null, note?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (graceTimer) clearTimeout(graceTimer)
      signal?.removeEventListener('abort', onAbort)
      const parts = [out.trim(), err.trim() ? `[stderr]\n${err.trim()}` : '', note ?? ''].filter(Boolean)
      resolve({ ok, exitCode, output: parts.join('\n\n'), timedOut, aborted: signal?.aborted === true })
    }
    // After a kill, 'close' should follow promptly; if the process is unkillable, settle anyway so the
    // scheduler chain never hangs on one stuck step.
    const armGrace = (note: string): void => {
      if (graceTimer) return
      graceTimer = setTimeout(() => finish(false, null, note), KILL_GRACE_MS)
    }
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) killTree(child.pid)
      armGrace(`[timed out after ${Math.round(timeoutMs / 1000)}s — process did not exit]`)
    }, timeoutMs)
    const onAbort = (): void => {
      if (child.pid) killTree(child.pid)
      armGrace('[stopped — process did not exit]')
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (d: Buffer) => (out = keepTail(out, d.toString('utf8'))))
    child.stderr?.on('data', (d: Buffer) => (err = keepTail(err, d.toString('utf8'))))
    child.on('error', (e) => finish(false, null, `spawn failed: ${e.message}`))
    child.on('close', (code) => {
      const aborted = signal?.aborted === true
      const note = timedOut
        ? `[timed out after ${Math.round(timeoutMs / 1000)}s — process tree killed]`
        : aborted
          ? '[stopped]'
          : undefined
      finish(code === 0 && !timedOut && !aborted, code, note)
    })
  })
}
