// Robustness: firing two sends back-to-back on a FRESH thread must NOT create two conversations — the
// `creating` guard (and the activeConv handoff) should collapse them into one. A duplicate-conversation
// race is a classic "I pressed enter twice and now there are two chats" bug. MANUAL — real LLM.
// SKIPs if generalist isn't bound to a keyed endpoint.
//   node e2e/verify-rapid-send.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async () => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'generalist')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'generalist')) await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'generalist' }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ generalist: 'bypass' }))
  return { ok: true }
})
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP — generalist not bound to a keyed endpoint'); await app.close(); process.exit(0) }
await page.reload()
await page.waitForTimeout(1500)

// fresh thread (no active conv) — fire two sends as fast as possible
await page.fill('textarea.cmp-textarea', 'Rapid double send — reply with one short word.')
await page.keyboard.press('Enter')
await page.fill('textarea.cmp-textarea', 'Rapid double send — reply with one short word.')
await page.keyboard.press('Enter')

// let everything settle
for (let i = 0; i < 30; i++) { await page.waitForTimeout(1500); if (!(await page.$('.cmp-stop')) && i > 2) break }
await page.waitForTimeout(1500)

const probe = await page.evaluate(async () => {
  const convs = (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'generalist')
  const perConv = []
  for (const c of convs) {
    const msgs = await window.api.conversations.messages(c.id)
    perConv.push({ users: msgs.filter((m) => m.author === 'user').length, asst: msgs.filter((m) => m.author !== 'user').length })
  }
  return { convCount: convs.length, perConv }
})
await page.evaluate(async () => { for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'generalist')) await window.api.conversations.remove(c.id) })
await app.close()

console.log('generalist conversations created:', probe.convCount, '| per-conv:', JSON.stringify(probe.perConv))

const fails = []
if (probe.convCount === 0) fails.push('no conversation created at all (send broken)')
if (probe.convCount > 1) fails.push(`DUPLICATE: ${probe.convCount} conversations created by a fresh-thread double-send (creating guard failed)`)
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : '\n✓ PASS — a fresh-thread double-send collapsed into exactly one conversation (no duplicate-chat race)'
)
process.exit(fails.length ? 1 : 0)
