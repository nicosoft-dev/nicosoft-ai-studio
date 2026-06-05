// Batch 3 verify for the Scheduled PAGE wiring (doc 28): the page is backed by window.api.scheduled.* (the
// real store), not the STUDIO_DATA mock. We exercise the full management surface through the bridge and prove
// the page's DOM reflects the store — a task created via IPC must appear in a .sched-row on the Scheduled
// page (if it still rendered mock data, our task would be absent). Plus durable persistence + toggle/update/
// delete. (UI-driven form filling of the segmented/dropdown editor is brittle to selector drift, so we drive
// CRUD through the bridge the page itself calls, and assert the page renders the result.)
//   node e2e/verify-scheduled-ui.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TASKS_FILE = join(homedir(), '.nsai', 'scheduled_tasks.json')
const readTasks = () => { try { return JSON.parse(readFileSync(TASKS_FILE, 'utf8')).tasks ?? [] } catch { return [] } }
const cleanup = () => { try { if (existsSync(TASKS_FILE)) writeFileSync(TASKS_FILE, JSON.stringify({ tasks: readTasks().filter((x) => !/E2E/i.test(x.name || '')) }, null, 2)) } catch { /**/ } }
cleanup()

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

// 1. Create a durable recurring expert task through the bridge (exactly what the editor's Save calls).
const created = await page.evaluate(async () =>
  window.api.scheduled.create({
    name: 'E2E weekly report',
    schedule: '0 9 * * 1',
    durable: true,
    steps: [{ kind: 'expert', roleId: 'analyst', prompt: 'Summarize the week.' }],
  })
)
console.log('created:', JSON.stringify({ id: created.id, cron: created.cron, recurring: created.recurring, enabled: created.enabled, steps: created.steps.length }))
const inList = await page.evaluate(async (id) => (await window.api.scheduled.list()).some((t) => t.id === id), created.id)

// 2. Navigate to the Scheduled page and confirm the DOM shows the created task (proves it reads the store).
//    Park on another view first so Scheduled mounts FRESH after the task exists — mirrors a user opening the
//    page (ScheduledView loads its list on mount; it doesn't poll, so a view already parked on Scheduled when
//    an external source mutates the store won't re-fetch on its own).
await page.evaluate(() => { const r = [...document.querySelectorAll('.studio-nav-row')].find((x) => /Projects/i.test(x.textContent || '')); r?.click() })
await page.waitForTimeout(400)
const navClicked = await page.evaluate(() => {
  const r = [...document.querySelectorAll('.studio-nav-row')].find((x) => /Scheduled/i.test(x.textContent || ''))
  if (r) { r.click(); return true } else return false
})
await page.waitForTimeout(1500)
const domHasTask = await page.evaluate((name) => [...document.querySelectorAll('.sched-name')].some((e) => e.textContent === name), 'E2E weekly report')
const domTrigger = await page.evaluate(() => document.querySelector('.sched-trigger')?.textContent ?? '')

// 3. Toggle off through the bridge; enabled must flip.
await page.evaluate(async (id) => window.api.scheduled.setEnabled(id, false), created.id)
const afterToggle = await page.evaluate(async (id) => (await window.api.scheduled.list()).find((t) => t.id === id)?.enabled, created.id)

// 4. Update (rename + reschedule); list must reflect it.
await page.evaluate(async (id) =>
  window.api.scheduled.update(id, { name: 'E2E renamed', schedule: '30 10 * * 3', durable: true, steps: [{ kind: 'expert', roleId: 'analyst', prompt: 'x' }] }), created.id)
const updated = await page.evaluate(async (id) => { const t = (await window.api.scheduled.list()).find((x) => x.id === id); return { name: t?.name, cron: t?.cron } }, created.id)

// 5. Durable JSON persisted.
const durable = readTasks().find((t) => t.id === created.id)

// 6. Delete; gone from list.
await page.evaluate(async (id) => window.api.scheduled.remove(id), created.id)
const goneFromList = await page.evaluate(async (id) => !(await window.api.scheduled.list()).some((t) => t.id === id), created.id)

await app.close()

console.log('\n===== SCHEDULED PAGE (BATCH 3) VERIFY =====')
console.log('in list after create:', inList)
console.log('Scheduled page DOM shows task (reads store, not mock):', domHasTask, '| nav clicked:', navClicked, '| trigger label:', JSON.stringify(domTrigger))
console.log('toggle off → enabled:', afterToggle)
console.log('update → name/cron:', JSON.stringify(updated))
console.log('durable JSON persisted:', !!durable)
console.log('delete → gone from list:', goneFromList)
const fails = []
if (errors.length) fails.push('renderer errors: ' + JSON.stringify(errors.slice(0, 4)))
if (!inList) fails.push('created task not in scheduled.list()')
if (!domHasTask) fails.push('Scheduled page DOM does not show the created task (page still rendering mock data?)')
if (afterToggle !== false) fails.push('setEnabled(false) did not flip enabled')
if (updated.name !== 'E2E renamed' || updated.cron !== '30 10 * * 3') fails.push(`update did not apply: ${JSON.stringify(updated)}`)
if (!durable) fails.push('task not persisted to durable JSON')
if (!goneFromList) fails.push('delete did not remove task')
cleanup()
console.log(fails.length ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ') : '\n✓ PASS — Scheduled page is backed by the real store: create/list/DOM-render/toggle/update/delete + durable persistence all work')
process.exit(fails.length ? 1 : 0)
