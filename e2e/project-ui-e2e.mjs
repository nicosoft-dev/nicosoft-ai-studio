// E2E for doc 19 §13 phase 5d — Projects UI backed by the real service/DB. Proves: ProjectsView lists
// real projects, the detail workbench renders one swimlane per expert with task cards from the plan, and
// the New Project flow (folder + goal + explicit name) creates a project that persists + appears. NO LLM
// — an explicit name skips title generation, so this is pure DB + UI and runs in seconds.
//   node e2e/project-ui-e2e.mjs
import { _electron } from 'playwright'
import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stderr?.on('data', (d) => process.stderr.write('[main:err] ' + d.toString()))
const page = await app.firstWindow()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(800)

// Seed a project with a 2-task plan directly via the IPC (no LLM), then open the Projects view.
const seedId = await page.evaluate(async () => {
  const p = await window.api.project.create({ title: 'E2E seed project', goal: 'A backend API plus a frontend UI', cwd: '/tmp/ui-seed' })
  await window.api.project.addTask(p.id, { title: 'Build the scores API', assigneeRoleId: 'engineer' })
  await window.api.project.addTask(p.id, { title: 'Build the leaderboard UI', assigneeRoleId: 'shuri' })
  return p.id
})
await page.evaluate(() => localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'projects' })))
await page.reload()
await page.waitForTimeout(1000)

// 1. List shows the seeded project (real DB, not mock).
await page.screenshot({ path: '/tmp/project-ui-list.png', fullPage: true })
const listTitles = await page.$$eval('.proj-card .pc-title', (els) => els.map((e) => e.textContent))
assert.ok(listTitles.includes('E2E seed project'), `seeded project listed (got ${JSON.stringify(listTitles)})`)

// 2. Open the seed project's detail → lanes render from the plan (a lane per expert + task cards).
await page.evaluate((id) => {
  const cards = [...document.querySelectorAll('.proj-card')]
  const titles = [...document.querySelectorAll('.proj-card .pc-title')]
  const i = titles.findIndex((t) => t.textContent === 'E2E seed project')
  void id
  if (i >= 0) cards[i].click()
}, seedId)
await page.waitForTimeout(900)
await page.screenshot({ path: '/tmp/project-ui-detail.png', fullPage: true })
const lanes = await page.$$eval('.wb-lane .wb-name', (els) => els.map((e) => e.textContent))
const taskCards = await page.$$eval('.wb-card .wb-card-title', (els) => els.map((e) => e.textContent))
assert.ok(lanes.includes('Danny') && lanes.includes('Flynn') && lanes.includes('Shuri'), `lanes per expert (got ${JSON.stringify(lanes)})`)
assert.ok(
  taskCards.includes('Build the scores API') && taskCards.includes('Build the leaderboard UI'),
  `task cards from the plan (got ${JSON.stringify(taskCards)})`
)

// 3. New Project flow: back to list, open dialog, fill folder+goal+explicit name, create.
await page.click('.conv-header .btn.ghost.sm') // Projects (back)
await page.waitForTimeout(500)
await page.click('.conv-header .btn.primary') // New Project
await page.waitForTimeout(400)
assert.ok(await page.$('.overlay .dialog'), 'New Project dialog opened')
await page.fill('.np-path .input', '/tmp/ui-newproj')
await page.fill('.dialog-body textarea', 'A waitlist landing page with an email capture form')
const nameInputs = await page.$$('.dialog-body input.input')
await nameInputs[nameInputs.length - 1].fill('Waitlist page') // explicit name → skips LLM generation
await page.waitForTimeout(200)
await page.screenshot({ path: '/tmp/project-ui-newdialog.png' })
await page.click('.dialog-foot .btn.primary') // Create
await page.waitForTimeout(1200)

// 4. Created project persisted with the explicit name + the create opened its detail.
const titles = await page.evaluate(async () => (await window.api.project.list()).map((p) => p.title))
const detailTitle = await page.$eval('.wb-col .conv-title', (e) => e.textContent).catch(() => null)
console.log('list:', JSON.stringify(listTitles))
console.log('lanes:', JSON.stringify(lanes), '| tasks:', JSON.stringify(taskCards))
console.log('after-create titles:', JSON.stringify(titles), '| opened detail:', detailTitle)
console.log('page errors:', errors.length ? JSON.stringify(errors) : 'none')

assert.equal(errors.length, 0, 'no JS errors:\n' + errors.join('\n'))
assert.ok(titles.includes('Waitlist page'), `New Project persisted with the explicit name (got ${JSON.stringify(titles)})`)
assert.equal(detailTitle, 'Waitlist page', 'create opened the new project detail')

await app.close()
console.log('✓ project UI e2e OK — real list + plan-driven lanes + New Project create')
process.exit(0)
