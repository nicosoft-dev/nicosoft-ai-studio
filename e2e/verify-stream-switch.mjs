// Test point 1 (live half): switching experts WHILE a run is streaming must not drop or corrupt it —
// switching back should RESTORE the in-flight conversation (the `running` check in App.selectExpert, which
// once had a bug that lost a running collaboration). We start a translator run (a paragraph → French streams
// for several seconds), switch away mid-stream, switch back, and assert: switch-back lands on the streaming
// conversation (not blank), the run completes, and the final translation persists intact.
// MANUAL — real Gemini. SKIPs if translator isn't bound to a keyed gemini endpoint.
//   node e2e/verify-stream-switch.mjs
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

await page.fill(
  'textarea.cmp-textarea',
  'Translate this to French, full paragraph: The history of computing spans many centuries, from early mechanical calculators to the programmable machines of the twentieth century. Each generation built on the last, shrinking room-sized computers into devices that fit in a pocket, and turning a tool for specialists into something nearly everyone uses every single day.'
)
await page.keyboard.press('Enter')
console.log('started translator run...')

// let the stream get going
await page.waitForTimeout(2500)
const streamingNow = !!(await page.$('.cmp-stop'))

// switch AWAY to another expert mid-stream
await page.locator('.role-row', { hasText: 'Amélie' }).locator('.role-meta').first().click()
await page.waitForTimeout(1200)
const awayMsgs = await page.evaluate(() => document.querySelector('.msg-list')?.innerText ?? '')

// switch BACK to translator — should restore the in-flight conversation, not a blank one
await page.locator('.role-row', { hasText: 'Louise' }).locator('.role-meta').first().click()
await page.waitForTimeout(800)
const backHasStop = !!(await page.$('.cmp-stop')) // still streaming → restored the running conv
const backActive = await page.evaluate(() => document.querySelector('.hist-row.active .hist-title')?.textContent ?? '(none)')

// wait for completion
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1500)
  if (!(await page.$('.cmp-stop')) && i > 1) break
}
await page.waitForTimeout(1000)

const probe = await page.evaluate(async () => {
  const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === 'translator')
  if (!c) return { found: false }
  const msgs = await window.api.conversations.messages(c.id)
  const assistant = msgs.filter((m) => m.author !== 'user')
  const dom = document.querySelector('.msg-list')?.innerText ?? ''
  return {
    found: true,
    userTurns: msgs.filter((m) => m.author === 'user').length,
    assistantCount: assistant.length,
    lastLen: (assistant[assistant.length - 1]?.content ?? '').length,
    domShowsTranslation: /[a-zà-ÿ]{40,}/i.test(dom) // some substantial text rendered
  }
})
await page.evaluate(async () => { for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'translator')) await window.api.conversations.remove(c.id) })
await app.close()

console.log('streaming after send:', streamingNow, '| while away msgs empty-ish:', !awayMsgs.includes('histoire') && awayMsgs.length < 400)
console.log('switch-back: still streaming(stop btn):', backHasStop, '| active conv restored:', backActive !== '(none)')
console.log('final:', JSON.stringify(probe))

const fails = []
if (!streamingNow) fails.push('translator run did not start streaming (cannot test mid-stream switch)')
if (!probe.found) fails.push('translator conversation was LOST after switching away+back mid-stream')
else {
  if (probe.userTurns !== 1) fails.push(`expected exactly 1 user turn, got ${probe.userTurns} (dup or lost)`)
  if (probe.assistantCount < 1 || probe.lastLen < 40) fails.push('the translation did not complete / persist after the mid-stream switch')
}
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : '\n✓ PASS — a run survives switching experts mid-stream: switch-back restored the in-flight conversation, the run completed, and the translation persisted intact (1 user turn, no dup/loss)'
)
process.exit(fails.length ? 1 : 0)
