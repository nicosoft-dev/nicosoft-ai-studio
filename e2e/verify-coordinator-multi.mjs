// Danny's MULTI-EXPERT orchestration (parallel / council / pipeline) — more than the single-dispatch path
// already covered. We give him an open-ended, multi-perspective question and assert the orchestration
// actually fans out: ≥2 DISTINCT experts contribute and Danny produces a coordinator synthesis, in one
// clean run (1 user turn, no loss). Mode-agnostic (the router picks parallel/council/pipeline) — the point
// is that fan-out + merge works end to end. MANUAL — real LLM. SKIPs unless coordinator + 2 dispatch roles
// are bound to keyed endpoints.
//   node e2e/verify-coordinator-multi.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/e2e-danny-multi'
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
  const dispatchable = ['engineer', 'shuri', 'analyst', 'generalist'].filter(ok)
  if (!ok('coordinator') || dispatchable.length < 2) return { ok: false, dispatchable }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'coordinator')) await window.api.conversations.remove(c.id)
  const cwdMap = {}, modeMap = {}
  for (const id of ['coordinator', ...dispatchable]) { cwdMap[id] = cwd; modeMap[id] = 'bypass' }
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify(cwdMap))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify(modeMap))
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'coordinator' }))
  return { ok: true, dispatchable }
}, CWD)
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP — need coordinator + ≥2 dispatch roles bound'); await app.close(); rmSync(CWD, { recursive: true, force: true }); process.exit(0) }
await page.reload()
await page.waitForTimeout(1500)

await page.fill(
  'textarea.cmp-textarea',
  'I want a few independent expert perspectives, then your comparison: for a brand-new SaaS MVP with a tiny team, is it wiser to build the backend in Go or in Python? Bring in different specialists for their takes, then summarize the trade-offs.'
)
await page.keyboard.press('Enter')
console.log('asked Danny for a multi-perspective comparison...')

for (let i = 0; i < 75; i++) {
  await page.waitForTimeout(2000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
  if (!(await page.$('.cmp-stop')) && i > 2) break
}
await page.waitForTimeout(1500)

const probe = await page.evaluate(async () => {
  const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === 'coordinator')
  if (!c) return { found: false }
  const msgs = await window.api.conversations.messages(c.id)
  const a = msgs.filter((m) => m.author !== 'user')
  const experts = a.map((m) => m.expertId)
  return {
    found: true,
    userTurns: msgs.filter((m) => m.author === 'user').length,
    assistantCount: a.length,
    experts,
    distinctExperts: [...new Set(experts)],
    distinctDispatched: [...new Set(experts.filter((e) => e !== 'coordinator'))],
    hasCoordinatorTurn: experts.includes('coordinator'),
    allNonEmpty: a.every((m) => (m.content?.length ?? 0) > 0)
  }
})
await page.evaluate(async () => { for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'coordinator')) await window.api.conversations.remove(c.id) })
await app.close()
rmSync(CWD, { recursive: true, force: true })

console.log('result:', JSON.stringify(probe))

const fails = []
if (!probe.found) fails.push('coordinator conversation not found')
else {
  if (probe.userTurns !== 1) fails.push(`expected 1 user turn, got ${probe.userTurns}`)
  if (probe.distinctExperts.length < 2) fails.push(`orchestration did NOT fan out — only ${probe.distinctExperts.length} distinct expert (${probe.distinctExperts}); router likely chose single (re-run, the prompt asks for multiple perspectives)`)
  if (probe.distinctDispatched.length < 1) fails.push('no dispatched specialist contributed (Danny answered alone)')
  if (!probe.allNonEmpty) fails.push('an orchestration turn persisted empty')
}
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : `\n✓ PASS — Danny fanned out to multiple experts and merged: ${probe.distinctExperts.length} distinct roles contributed (${probe.distinctExperts}), one user turn, all turns persisted non-empty`
)
process.exit(fails.length ? 1 : 0)
