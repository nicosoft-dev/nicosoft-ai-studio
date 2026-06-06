// Robustness: two conversations streaming AT THE SAME TIME (translator still translating while a generalist
// run starts) must stay fully isolated — each accumulates only its own deltas, both complete, neither bleeds
// into the other. All per-conversation state is keyed by convId, so concurrency should be safe; this proves
// it. MANUAL — real LLM. SKIPs unless translator (gemini) AND generalist are both bound to keyed endpoints.
//   node e2e/verify-concurrent-streams.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async () => {
  const binds = await window.api.roles.listBindings()
  const eps = await window.api.endpoints.list()
  const ok = (id) => { const b = binds.find((x) => x.roleId === id); const e = eps.find((e) => e.id === b?.endpointId); return !!(b?.endpointId && b?.model && e?.hasKey) }
  if (!ok('translator') || !ok('generalist')) return { ok: false }
  for (const c of (await window.api.conversations.list()).filter((c) => ['translator', 'generalist'].includes(c.primaryRoleId))) await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'translator' }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ translator: 'bypass', generalist: 'bypass' }))
  return { ok: true }
})
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP — translator + generalist not both bound to keyed endpoints'); await app.close(); process.exit(0) }
await page.reload()
await page.waitForTimeout(1500)

// 1. start a LONG translator run
await page.fill('textarea.cmp-textarea', 'Translate to French, full paragraph: ' + 'Across the centuries,人 built tools that reshaped how they lived and worked, from the first wheels and levers to engines, telegraphs, and finally the networked computers that now connect nearly every corner of the planet in an instant.')
await page.keyboard.press('Enter')
await page.waitForTimeout(1500)
const tStreaming = !!(await page.$('.cmp-stop'))

// 2. switch to generalist and start a SECOND run while the first is still going
await page.locator('.role-row', { hasText: 'Amélie' }).locator('.role-meta').first().click()
await page.waitForTimeout(600)
await page.fill('textarea.cmp-textarea', 'Write one short haiku about the ocean. Just the haiku.')
await page.keyboard.press('Enter')
await page.waitForTimeout(1200)
const bothStreaming = await page.evaluate(async () => {
  const list = await window.api.conversations.list()
  const t = list.find((c) => c.primaryRoleId === 'translator')
  const g = list.find((c) => c.primaryRoleId === 'generalist')
  return { tExists: !!t, gExists: !!g }
})

// 3. wait for BOTH to settle (generalist active now; translator finishes in the background)
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1500)
  if (!(await page.$('.cmp-stop')) && i > 1) break
}
await page.waitForTimeout(3000) // give the backgrounded translator run time to land too

const probe = await page.evaluate(async () => {
  const list = await window.api.conversations.list()
  const t = list.find((c) => c.primaryRoleId === 'translator')
  const g = list.find((c) => c.primaryRoleId === 'generalist')
  const grab = async (c) => {
    if (!c) return null
    const msgs = await window.api.conversations.messages(c.id)
    const a = msgs.filter((m) => m.author !== 'user')
    return { users: msgs.filter((m) => m.author === 'user').length, asst: a.length, text: a.map((m) => m.content).join('\n') }
  }
  return { t: await grab(t), g: await grab(g) }
})
await page.evaluate(async () => { for (const c of (await window.api.conversations.list()).filter((c) => ['translator', 'generalist'].includes(c.primaryRoleId))) await window.api.conversations.remove(c.id) })
await app.close()

console.log('translator streaming when generalist started:', tStreaming, '| both convs exist:', JSON.stringify(bothStreaming))
console.log('translator final:', JSON.stringify({ users: probe.t?.users, asst: probe.t?.asst, len: probe.t?.text.length }))
console.log('generalist final:', JSON.stringify({ users: probe.g?.users, asst: probe.g?.asst, len: probe.g?.text.length }))

const fails = []
if (!tStreaming) fails.push('translator run never started streaming (cannot test concurrency)')
if (!probe.t || !probe.g) fails.push('a conversation was lost during concurrent streaming')
else {
  if (probe.t.users !== 1 || probe.g.users !== 1) fails.push(`expected 1 user turn each (got t=${probe.t.users}, g=${probe.g.users})`)
  if (probe.t.asst < 1 || probe.t.text.length < 40) fails.push('translator run did not complete during concurrency')
  if (probe.g.asst < 1 || probe.g.text.length < 5) fails.push('generalist run did not complete during concurrency')
  if (probe.t.text && probe.t.text === probe.g.text) fails.push('BLEED: both conversations ended with the SAME assistant text')
}
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : '\n✓ PASS — two runs streamed concurrently and stayed isolated: both completed, each kept exactly its own turn, no cross-bleed'
)
process.exit(fails.length ? 1 : 0)
