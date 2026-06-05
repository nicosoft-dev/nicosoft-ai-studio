// Runtime check of the idle-timeout guard's timer behavior — the hang it defends against is a rare upstream
// event we can't reliably trigger in an e2e, so we drive the guard directly with a short idleMs and observe
// its AbortSignal. Run: node --experimental-strip-types e2e/verify-stream-timeout.ts
import { streamIdleGuard } from '../src/main/agent/stream-timeout.ts'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const fails: string[] = []

// 1. armed, then silence longer than idleMs → aborts (this is the hung-upstream case).
{
  const g = streamIdleGuard(undefined, 200)
  g.reset()
  await sleep(350)
  if (!g.signal.aborted) fails.push('idle: did not abort after silence > idleMs')
  g.dispose()
}

// 2. armed, but reset on a steady cadence (a live stream) → never aborts.
{
  const g = streamIdleGuard(undefined, 200)
  g.reset()
  for (let i = 0; i < 4; i++) {
    await sleep(100)
    g.reset()
  }
  if (g.signal.aborted) fails.push('live: aborted despite continuous resets (would kill a healthy stream)')
  g.dispose()
}

// 3. run/abort signal fires → guard propagates it immediately (a user Stop must still abort).
{
  const ctrl = new AbortController()
  const g = streamIdleGuard(ctrl.signal, 9999)
  ctrl.abort()
  await sleep(10)
  if (!g.signal.aborted) fails.push('run-abort: did not propagate the run signal')
  g.dispose()
}

// 4. dispose clears the timer → no late abort after the call finished normally.
{
  const g = streamIdleGuard(undefined, 200)
  g.reset()
  g.dispose()
  await sleep(350)
  if (g.signal.aborted) fails.push('dispose: aborted after dispose (timer leaked)')
}

console.log(
  fails.length
    ? '✗ FAIL:\n  - ' + fails.join('\n  - ')
    : '✓ PASS — streamIdleGuard: idle→abort, steady-stream→alive, run-abort→propagate, dispose→cleared'
)
process.exit(fails.length ? 1 : 0)
