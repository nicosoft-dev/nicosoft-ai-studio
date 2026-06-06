// Per-role regression smoke for the roles not exercised by a dedicated e2e this session: Turing (analyst,
// OpenAI), Joan (scheduler, OpenAI), Shuri (frontend, Anthropic). Each must take a simple turn through its
// agent loop and persist a non-empty reply (1 user turn, ≥1 assistant). Drives the REAL sidebar (role-row
// click = selectExpert) + composer. Per-role SKIP if unbound. MANUAL — real LLM.
//   node e2e/verify-roles-smoke.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/e2e-roles-smoke'
rmSync(CWD, { recursive: true, force: true })
mkdirSync(CWD, { recursive: true })

const ROLES = [
  { id: 'analyst', name: 'Turing', prompt: 'What is the median of 4, 8, 15, 16, 23, 42? Reply with just the number.' },
  { id: 'scheduler', name: 'Joan', prompt: 'Draft a one-sentence reminder to call the dentist tomorrow morning. Just the sentence.' },
  { id: 'shuri', name: 'Shuri', prompt: 'Write a minimal React button component named FancyButton in a single short code block. No explanation.' }
]

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const bound = await page.evaluate(async (roleIds) => {
  const binds = await window.api.roles.listBindings()
  const eps = await window.api.endpoints.list()
  const ok = {}
  for (const id of roleIds) { const b = binds.find((x) => x.roleId === id); const e = eps.find((e) => e.id === b?.endpointId); ok[id] = !!(b?.endpointId && b?.model && e?.hasKey) }
  for (const c of (await window.api.conversations.list()).filter((c) => roleIds.includes(c.primaryRoleId))) await window.api.conversations.remove(c.id)
  return ok
}, ROLES.map((r) => r.id))
await page.evaluate((cwd) => {
  const map = {}; for (const id of ['analyst', 'scheduler', 'shuri']) map[id] = cwd
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify(map))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ analyst: 'bypass', scheduler: 'bypass', shuri: 'bypass' }))
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'analyst' }))
}, CWD)
await page.reload()
await page.waitForTimeout(1500)

const results = {}
for (const r of ROLES) {
  if (!bound[r.id]) { results[r.id] = 'SKIP (unbound)'; console.log(`${r.name} (${r.id}): SKIP — unbound`); continue }
  await page.locator('.role-row', { hasText: r.name }).locator('.role-meta').first().click()
  await page.waitForTimeout(700)
  await page.fill('textarea.cmp-textarea', r.prompt)
  await page.keyboard.press('Enter')
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(1500)
    if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
    if (!(await page.$('.cmp-stop')) && i > 1) break
  }
  await page.waitForTimeout(800)
  const probe = await page.evaluate(async (roleId) => {
    const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === roleId)
    if (!c) return { found: false }
    const msgs = await window.api.conversations.messages(c.id)
    const a = msgs.filter((m) => m.author !== 'user')
    return { found: true, users: msgs.filter((m) => m.author === 'user').length, asst: a.length, len: a.reduce((n, m) => n + (m.content?.length ?? 0), 0), tail: (a[a.length - 1]?.content ?? '').replace(/\s+/g, ' ').slice(0, 70) }
  }, r.id)
  const ok = probe.found && probe.users === 1 && probe.asst >= 1 && probe.len > 0
  results[r.id] = ok ? 'PASS' : `FAIL ${JSON.stringify(probe)}`
  console.log(`${r.name} (${r.id}): ${ok ? 'PASS' : 'FAIL'} — ${JSON.stringify({ users: probe.users, asst: probe.asst, len: probe.len })} | "${probe.tail}"`)
}

await page.evaluate(async (roleIds) => { for (const c of (await window.api.conversations.list()).filter((c) => roleIds.includes(c.primaryRoleId))) await window.api.conversations.remove(c.id) }, ROLES.map((r) => r.id))
await app.close()
rmSync(CWD, { recursive: true, force: true })

const failed = Object.entries(results).filter(([, v]) => v.startsWith('FAIL'))
console.log(
  failed.length
    ? '\n✗ FAIL:\n  - ' + failed.map(([k, v]) => `${k}: ${v}`).join('\n  - ')
    : '\n✓ PASS — ' + Object.entries(results).map(([k, v]) => `${k}:${v.split(' ')[0]}`).join(', ') + ' (each bound role took a turn + persisted a reply)'
)
process.exit(failed.length ? 1 : 0)
