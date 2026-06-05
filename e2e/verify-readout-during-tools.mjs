// Verify the live token/elapsed readout stays visible DURING tool execution (the "状态不见了" bug: it
// vanished the instant the assistant text finished but tools were still running, because it was gated on
// msg.streaming only). engineer runs a slow Bash (sleep 4) so there's a clear tool-execution window with
// msg.streaming=false but a running tool; we sample whether the live readout (.thinking-readout[aria-label=
// "thinking"]) is present while a .tool-bubble.running exists. Pre-fix it would be absent (only the static
// msg-tokens, or nothing).
//   node e2e/verify-readout-during-tools.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stderr?.on('data', () => {})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async () => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'engineer')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false, why: 'engineer not bound to a keyed endpoint' }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'engineer')) await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ engineer: '/tmp' }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ engineer: 'bypass' }))
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'engineer' }))
  return { ok: true }
})
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP —', setup.why); await app.close(); process.exit(0) }

await page.reload()
await page.waitForTimeout(1500)
await page.fill('textarea.cmp-textarea', 'Run EXACTLY this one Bash command and then report its output — do nothing else, call no other tool: sleep 4 && echo TOOLDONE')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')

// Sample fast. Count, among samples where a tool is RUNNING, how many also show the live "thinking" readout.
let toolRunningSamples = 0
let readoutDuringTool = 0
let sawStaticInstead = 0
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(250)
  const s = await page.evaluate(() => ({
    running: !!document.querySelector('.tool-bubble.running'),
    live: !!document.querySelector('.thinking-readout[aria-label="thinking"]'),
    staticTokens: !!document.querySelector('.thinking-readout[aria-label="tokens"]'),
    stop: !!document.querySelector('.cmp-stop')
  }))
  if (s.running) {
    toolRunningSamples++
    if (s.live) readoutDuringTool++
    else if (s.staticTokens) sawStaticInstead++
  }
  if (!s.stop && i > 4) break
}
// After the turn finishes / goes idle, NO token readout should linger (it used to stay as a static row).
await page.waitForTimeout(1500)
const afterDone = await page.evaluate(() => ({
  anyReadout: !!document.querySelector('.thinking-readout'),
  stop: !!document.querySelector('.cmp-stop')
}))
await app.close()

console.log('\n===== READOUT VERIFY (present during tools, gone when idle) =====')
console.log('samples with a running tool:', toolRunningSamples, '| live readout present:', readoutDuringTool, '| only static:', sawStaticInstead)
console.log('after done — idle:', !afterDone.stop, '| any readout lingering:', afterDone.anyReadout)
const fails = []
if (toolRunningSamples < 3) fails.push('never observed a running tool long enough (Bash may not have run) — inconclusive')
else if (readoutDuringTool < Math.max(2, Math.floor(toolRunningSamples * 0.5))) fails.push(`live readout missing during tool execution (${readoutDuringTool}/${toolRunningSamples} samples)`)
if (!afterDone.stop && afterDone.anyReadout) fails.push('a token readout is STILL showing after the turn finished — it must disappear when idle')
console.log(fails.length ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ') : `\n✓ PASS — readout present during tools (${readoutDuringTool}/${toolRunningSamples}), and gone once idle`)
process.exit(fails.length ? 1 : 0)
