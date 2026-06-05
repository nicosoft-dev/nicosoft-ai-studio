// Batch A/B verify — failure visibility, conversation link, and live refresh on any change.
//   A1: a recurring task whose step role isn't bound MUST fail → runs[0] = {result:'error', error:'… not
//       bound'} and the Scheduled page shows .sched-last.error ("failed") — no more silent background failures.
//   A2: a recurring project-step task succeeds → runs[0] = {result:'ok', convId} → page Last is clickable.
//   B:  with the Scheduled page open, a task created via IPC appears WITHOUT re-opening (scheduled:changed).
//   node e2e/verify-scheduler-reliability.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TASKS_FILE = join(homedir(), '.nsai', 'scheduled_tasks.json')
const readTasks = () => { try { return JSON.parse(readFileSync(TASKS_FILE, 'utf8')).tasks ?? [] } catch { return [] } }
const writeTasks = (t) => writeFileSync(TASKS_FILE, JSON.stringify({ tasks: t }, null, 2))
const cleanTasks = () => { try { if (existsSync(TASKS_FILE)) writeTasks(readTasks().filter((x) => !/E2E/i.test(x.name || ''))) } catch { /**/ } }
cleanTasks()

// Recurring so they survive the fire (we read runs[0]); nextRunAt forced ~7s out.
const fireAt = Date.now() + 7000
writeTasks([...readTasks(),
  { id: 'e2efail1', name: 'E2E fail task', cron: '0 9 * * *', nextRunAt: fireAt, recurring: true, durable: true, enabled: true,
    steps: [{ kind: 'expert', roleId: 'nonexistent-role', prompt: 'never runs' }], cwd: '/tmp', createdAt: Date.now() },
  { id: 'e2eok1', name: 'E2E ok task', cron: '0 9 * * *', nextRunAt: fireAt, recurring: true, durable: true, enabled: true,
    steps: [{ kind: 'project', action: 'create', prompt: 'E2E reliability project' }], cwd: '/tmp', createdAt: Date.now() },
])

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
const perrors = []
page.on('pageerror', (e) => perrors.push(e.message))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1500)
await page.evaluate(async () => { for (const p of await window.api.project.list()) if ((p.title || '').includes('E2E reliability')) await window.api.project.remove(p.id) })

let fail = null, ok = null
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000)
  const snap = await page.evaluate(async () => (await window.api.scheduled.list()).filter((t) => /E2E (fail|ok) task/.test(t.name)).map((t) => ({ id: t.id, runs: t.runs })))
  fail = snap.find((t) => t.id === 'e2efail1')
  ok = snap.find((t) => t.id === 'e2eok1')
  if (fail?.runs?.length && ok?.runs?.length) break
}

// Open the Scheduled page (force the view + reload → fresh mount after the fires landed).
await page.evaluate(() => localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'scheduled' })))
await page.reload()
await page.waitForTimeout(1500)
const dom = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.sched-row')]
  const failRow = rows.find((r) => /E2E fail task/.test(r.textContent || ''))
  const okRow = rows.find((r) => /E2E ok task/.test(r.textContent || ''))
  return {
    failHasError: !!failRow?.querySelector('.sched-last.error'),
    failText: failRow?.querySelector('.sched-last')?.textContent?.trim() ?? '',
    okClickable: !!okRow?.querySelector('.sched-last.link'),
  }
})

// B: create a task via IPC while parked on the Scheduled page → it must appear without re-opening.
await page.evaluate(async () => window.api.scheduled.create({ name: 'E2E live add', schedule: '0 9 * * 2', durable: true, steps: [{ kind: 'expert', roleId: 'scheduler', prompt: 'x' }] }))
await page.waitForTimeout(1200)
const liveAdded = await page.evaluate(() => [...document.querySelectorAll('.sched-name')].some((e) => e.textContent === 'E2E live add'))

await page.evaluate(async () => { for (const p of await window.api.project.list()) if ((p.title || '').includes('E2E reliability')) await window.api.project.remove(p.id) })
await app.close()
cleanTasks()

console.log('fail runs[0]:', JSON.stringify(fail?.runs?.[0]))
console.log('ok runs[0]:', JSON.stringify(ok?.runs?.[0]))
console.log('DOM:', JSON.stringify(dom))
console.log('live-added without re-open:', liveAdded)
const fails = []
if (perrors.length) fails.push('renderer error(s): ' + JSON.stringify(perrors.slice(0, 2)))
if (fail?.runs?.[0]?.result !== 'error') fails.push('failed task did not record an error run (silent failure still!)')
else if (!/not bound/i.test(fail.runs[0].error || '')) fails.push(`error reason not captured: ${fail.runs[0].error}`)
if (ok?.runs?.[0]?.result !== 'ok') fails.push('successful task did not record an ok run')
else if (!ok.runs[0].convId) fails.push('ok run has no convId (no conversation link)')
if (!dom.failHasError) fails.push('Scheduled page does not show the failure (.sched-last.error)')
if (!dom.okClickable) fails.push('successful run Last is not clickable (no conversation link in UI)')
if (!liveAdded) fails.push('task created via IPC did not appear on the open Scheduled page (no live refresh)')
console.log(fails.length ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ') : '\n✓ PASS — failures visible (runs error + UI red), success links to its conversation, live refresh on change')
process.exit(fails.length ? 1 : 0)
