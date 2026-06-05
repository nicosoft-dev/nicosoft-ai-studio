// E2E (doc 28) — Danny orchestrates a scheduled task. The user asks Danny (coordinator) for a recurring job;
// Danny's router should recognize it, PLAN the chain in his intro, and route to Joan (scheduler); Joan LANDS
// it with schedule_create (bypass = no approval click — she's a small model doing the mechanical part). Proof:
// Joan's transcript carries a schedule_create call AND a scheduled task is persisted with a cron + steps.
// MANUAL — real LLM. SKIPs cleanly if coordinator/scheduler aren't bound to keyed endpoints.
//   node e2e/verify-danny-schedule.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TASKS_FILE = join(homedir(), '.nsai', 'scheduled_tasks.json')
const readTasks = () => { try { return JSON.parse(readFileSync(TASKS_FILE, 'utf8')).tasks ?? [] } catch { return [] } }
const cleanTasks = () => { try { if (existsSync(TASKS_FILE)) writeFileSync(TASKS_FILE, JSON.stringify({ tasks: readTasks().filter((x) => !/E2E|weekly report/i.test(x.name || '')) }, null, 2)) } catch { /**/ } }
cleanTasks()

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async () => {
  const binds = await window.api.roles.listBindings()
  const eps = await window.api.endpoints.list()
  const keyed = (id) => { const b = binds.find((x) => x.roleId === id); const e = eps.find((e) => e.id === b?.endpointId); return !!(b?.endpointId && b?.model && e?.hasKey) }
  if (!keyed('coordinator') || !keyed('scheduler')) return { ok: false }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'coordinator')) await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ scheduler: '/tmp' }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ scheduler: 'bypass' }))
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'coordinator' }))
  return { ok: true }
})
if (!setup.ok) { console.log('SKIP — coordinator/scheduler not bound to keyed endpoints'); await app.close(); process.exit(0) }
await page.reload()
await page.waitForTimeout(1500)

await page.fill('textarea.cmp-textarea', 'Set up a recurring task: every Monday at 9am, have Turing compute last week\'s metrics, then draft a short report, then email it to the team. Name it "E2E weekly report".')
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
console.log('asked Danny to schedule a weekly report — waiting for route → Joan → schedule_create...')

for (let i = 0; i < 75; i++) {
  await page.waitForTimeout(2000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
  if (!(await page.$('.cmp-stop')) && i > 2) break
}
await page.waitForTimeout(1500)

const probe = await page.evaluate(async () => {
  const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === 'coordinator')
  if (!c) return { tools: [], experts: [] }
  const t = await window.api.agent.transcript(c.id)
  const msgs = await window.api.conversations.messages(c.id)
  return {
    tools: Object.values(t).flatMap((r) => r.tools.map((x) => x.name)),
    experts: msgs.filter((m) => m.author !== 'user').map((m) => m.expertId),
  }
})
await app.close()

const task = readTasks().find((t) => /weekly report/i.test(t.name || ''))
console.log('\n===== DANNY ORCHESTRATES A SCHEDULED TASK (doc 28) =====')
console.log('experts (route):', JSON.stringify(probe.experts))
console.log('tools:', JSON.stringify(probe.tools))
console.log('task:', task ? JSON.stringify({ name: task.name, cron: task.cron, recurring: task.recurring, steps: task.steps?.length, kinds: task.steps?.map((s) => s.kind) }) : '(none)')
const fails = []
if (!probe.experts.includes('scheduler')) fails.push('Danny did not route to Joan (scheduler) — router prompt may not recognize scheduled tasks')
if (!probe.tools.includes('schedule_create')) fails.push('Joan did not call schedule_create')
if (!task) fails.push('no scheduled task persisted')
else {
  if (!task.cron) fails.push('task has no cron (cadence not landed)')
  if (!task.steps?.length) fails.push('task has no steps (Danny\'s plan not landed)')
}
cleanTasks()
console.log(fails.length ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ') : '\n✓ PASS — Danny planned + routed to Joan; Joan landed a scheduled task (cron + steps) via schedule_create')
process.exit(fails.length ? 1 : 0)
