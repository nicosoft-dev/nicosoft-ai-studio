// Batch 3 verify — project STEP kind (doc 28): a scheduled task with a project step must, when the engine
// fires it, create a Project via projectService directly (no agent, no LLM). We seed a durable one-shot
// project-create task, launch, wait for the engine, and confirm window.api.project.list() gained the project.
//   node e2e/verify-scheduler-project.mjs
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
const MARK = 'E2E scheduled project goal'
cleanTasks()

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

// Remove any leftover E2E project from a prior run.
await page.evaluate(async () => {
  for (const p of await window.api.project.list()) if ((p.title || '').includes('E2E scheduled project')) await window.api.project.remove(p.id)
})

const fireAt = Date.now() + 6000
writeTasks([...readTasks(), {
  id: 'e2eproj1', name: 'E2E project step', cron: null, nextRunAt: fireAt, recurring: false, durable: true, enabled: true,
  steps: [{ kind: 'project', action: 'create', prompt: MARK }], createdAt: Date.now(),
}])
console.log('seeded project-step task, fires in ~6s')

let found = null
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000)
  found = await page.evaluate(async () => (await window.api.project.list()).find((p) => (p.title || '').includes('E2E scheduled project')) ?? null)
  if (found) break
}
const remaining = readTasks().find((t) => t.id === 'e2eproj1')
if (found) await page.evaluate(async (id) => window.api.project.remove(id), found.id)
await app.close()

console.log('\n===== SCHEDULER PROJECT STEP (BATCH 3) VERIFY =====')
console.log('project created by engine:', !!found, found ? `(title: ${JSON.stringify(found.title)})` : '')
console.log('one-shot removed after firing:', !remaining)
const fails = []
if (!found) fails.push('engine did not create a project (project step did not execute)')
if (remaining) fails.push('one-shot task still in durable JSON after firing')
cleanTasks()
console.log(fails.length ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ') : '\n✓ PASS — project step executed: engine created a Project via projectService (no agent), one-shot cleaned up')
process.exit(fails.length ? 1 : 0)
