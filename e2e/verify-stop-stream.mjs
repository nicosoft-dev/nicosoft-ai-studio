// Robustness: stopping a run mid-stream must cleanly cancel — no stuck spinner, no wedged conversation —
// and the SAME conversation must stay fully usable afterward (a second message streams + completes). A
// botched cancel (dangling streamId, stuck streaming flag, half-written state) is a classic source of
// "the app froze". MANUAL — real Gemini. SKIPs if translator isn't bound to a keyed gemini endpoint.
//   node e2e/verify-stop-stream.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async () => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'translator')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey || ep.protocol !== 'gemini') return { ok: false }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'translator')) await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'translator' }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ translator: 'bypass' }))
  return { ok: true }
})
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP — translator not bound to a keyed gemini endpoint'); await app.close(); process.exit(0) }
await page.reload()
await page.waitForTimeout(1500)

// 1. start a long run, then STOP it mid-stream
await page.fill('textarea.cmp-textarea', 'Translate to French, in full: ' + 'The quick brown fox jumps over the lazy dog, again and again, across many long sentences describing a sprawling landscape of rolling hills, distant mountains, quiet rivers, and the slow turning of the seasons over many years. '.repeat(3))
await page.keyboard.press('Enter')
await page.waitForTimeout(2500)
const wasStreaming = !!(await page.$('.cmp-stop'))
const readoutWhileRunning = await page.evaluate(() => document.querySelector('.thinking-readout')?.textContent ?? null)
if (await page.$('.cmp-stop')) await page.$eval('.cmp-stop', (e) => e.click())
await page.waitForTimeout(1600)

// The live readout (elapsed + token counter) must STOP — its 250ms clock keeps ticking while the in-flight
// message is `streaming` or a tool is `running`. Sample twice: it should be GONE, and certainly not changing.
const readoutA = await page.evaluate(() => document.querySelector('.thinking-readout')?.textContent ?? null)
await page.waitForTimeout(1400)
const readoutB = await page.evaluate(() => document.querySelector('.thinking-readout')?.textContent ?? null)

const afterStop = await page.evaluate(async () => {
  const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === 'translator')
  return {
    stopGone: !document.querySelector('.cmp-stop'),
    canType: !document.querySelector('textarea.cmp-textarea')?.disabled,
    convId: c?.id ?? null
  }
})

// 2. the conversation must still be usable — send a SHORT second message and let it finish
await page.fill('textarea.cmp-textarea', 'Now just translate the single word: hello')
await page.keyboard.press('Enter')
await page.waitForTimeout(1500)
let finished = false
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1500)
  if (!(await page.$('.cmp-stop')) && i > 1) { finished = true; break }
}
await page.waitForTimeout(800)

const probe = await page.evaluate(async () => {
  const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === 'translator')
  if (!c) return { found: false }
  const msgs = await window.api.conversations.messages(c.id)
  const lastUser = [...msgs].reverse().find((m) => m.author === 'user')
  const lastAsst = [...msgs].reverse().find((m) => m.author !== 'user')
  return {
    found: true,
    userTurns: msgs.filter((m) => m.author === 'user').length,
    secondAccepted: (lastUser?.content ?? '').includes('hello'),
    secondAnswered: !!lastAsst && (lastAsst.content?.length ?? 0) > 0 && msgs.indexOf(lastAsst) > msgs.indexOf(lastUser)
  }
})
await page.evaluate(async () => { for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'translator')) await window.api.conversations.remove(c.id) })
await app.close()

console.log('was streaming:', wasStreaming, '| readout while running:', JSON.stringify(readoutWhileRunning))
console.log('readout after stop: A=', JSON.stringify(readoutA), 'B=', JSON.stringify(readoutB), '(want: gone/null)')
console.log('after stop:', JSON.stringify(afterStop))
console.log('second turn finished:', finished, '| probe:', JSON.stringify(probe))

const fails = []
if (!wasStreaming) fails.push('run never started streaming (cannot test stop)')
if (readoutWhileRunning === null) fails.push('no live readout while running — cannot verify it stops on cancel')
if (readoutB !== null) fails.push(`live readout STILL SHOWING ${readoutA !== readoutB ? 'AND COUNTING ' : ''}after stop ("${readoutB}") — the in-flight message was left streaming / a tool left running, so its clock never stopped`)
if (!afterStop.stopGone) fails.push('stop button still present after clicking stop — streaming flag stuck (wedged)')
if (!afterStop.canType) fails.push('composer disabled after stop — conversation wedged')
if (!probe.found) fails.push('conversation lost after stop')
else {
  if (!probe.secondAccepted) fails.push('second message after stop was not accepted (composer/send broken post-stop)')
  if (!probe.secondAnswered) fails.push('second message after stop got no reply — conversation wedged by the cancel')
}
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : '\n✓ PASS — stop cleanly cancels mid-stream and the conversation stays usable: stop button clears, composer re-enables, and a follow-up message streams + completes normally'
)
process.exit(fails.length ? 1 : 0)
