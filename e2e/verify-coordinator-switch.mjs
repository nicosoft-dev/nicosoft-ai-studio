// Test point 1 (Danny half): switching experts WHILE Danny is orchestrating (a dispatched expert streaming
// under the coordinator path) must not drop the orchestration — switching back restores it and it completes.
// Danny's path uses coordinatorMeta (streamId→conv), distinct from the single-agent path, so it's verified
// on its own. We ask Danny to have Flynn write code (→ dispatch), switch away mid-run, switch back, and
// assert the coordinator conversation survives, completes, and keeps exactly one user turn (no loss/dup).
// MANUAL — real LLM. SKIPs if coordinator/engineer aren't bound to keyed endpoints.
//   node e2e/verify-coordinator-switch.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/e2e-danny-switch'
rmSync(CWD, { recursive: true, force: true })
mkdirSync(CWD, { recursive: true })

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async (cwd) => {
  const binds = await window.api.roles.listBindings()
  const eps = await window.api.endpoints.list()
  const ok = (id) => { const b = binds.find((x) => x.roleId === id); const e = eps.find((e) => e.id === b?.endpointId); return !!(b?.endpointId && b?.model && e?.hasKey) }
  if (!ok('coordinator') || !ok('engineer')) return { ok: false }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'coordinator')) await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'coordinator' }))
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ coordinator: cwd, engineer: cwd }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ coordinator: 'bypass', engineer: 'bypass' }))
  return { ok: true }
}, CWD)
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP — coordinator/engineer not both bound to keyed endpoints'); await app.close(); rmSync(CWD, { recursive: true, force: true }); process.exit(0) }
await page.reload()
await page.waitForTimeout(1500)

await page.fill('textarea.cmp-textarea', 'Have Flynn write a production-ready Go function for a token-bucket rate limiter, with doc comments explaining each field.')
await page.keyboard.press('Enter')
console.log('asked Danny to dispatch Flynn...')

// wait through routing + into the dispatched stream
await page.waitForTimeout(5000)
const streamingMid = !!(await page.$('.cmp-stop'))

// switch AWAY mid-orchestration
await page.locator('.role-row', { hasText: 'Amélie' }).locator('.role-meta').first().click()
await page.waitForTimeout(1500)

// switch BACK to Danny — should restore the in-flight coordinator conversation
await page.locator('.role-row', { hasText: 'Danny' }).locator('.role-meta').first().click()
await page.waitForTimeout(800)
const backActive = await page.evaluate(() => document.querySelector('.hist-row.active .hist-title')?.textContent ?? '(none)')
const backHasStop = !!(await page.$('.cmp-stop'))

// wait for completion
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(2000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
  if (!(await page.$('.cmp-stop')) && i > 1) break
}
await page.waitForTimeout(1000)

const probe = await page.evaluate(async () => {
  const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === 'coordinator')
  if (!c) return { found: false }
  const msgs = await window.api.conversations.messages(c.id)
  const assistants = msgs.filter((m) => m.author !== 'user')
  return {
    found: true,
    userTurns: msgs.filter((m) => m.author === 'user').length,
    assistantCount: assistants.length,
    experts: [...new Set(assistants.map((m) => m.expertId))],
    totalLen: assistants.reduce((n, m) => n + (m.content?.length ?? 0), 0)
  }
})
await page.evaluate(async () => { for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'coordinator')) await window.api.conversations.remove(c.id) })
await app.close()
rmSync(CWD, { recursive: true, force: true })

console.log('streaming mid-run:', streamingMid)
console.log('switch-back: active restored:', backActive !== '(none)', '| still working:', backHasStop)
console.log('final:', JSON.stringify(probe))

const fails = []
if (!streamingMid) fails.push('Danny did not reach a streaming dispatch (router may have answered direct — re-run or sharpen the prompt)')
if (!probe.found) fails.push('coordinator conversation was LOST after switching away+back mid-orchestration')
else {
  if (probe.userTurns !== 1) fails.push(`expected exactly 1 user turn, got ${probe.userTurns} (dup/loss from the switch)`)
  if (probe.assistantCount < 1 || probe.totalLen < 40) fails.push('the orchestration produced no persisted reply after the mid-run switch')
}
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : `\n✓ PASS — Danny's orchestration survives a mid-run expert switch: switch-back restored the coordinator conversation, it completed, persisted (experts: ${probe.experts}), one user turn, no loss/dup`
)
process.exit(fails.length ? 1 : 0)
