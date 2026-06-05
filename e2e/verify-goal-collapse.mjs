// Verify the project-detail goal description collapses to a fixed 3 lines and toggles open/closed on click.
//   node e2e/verify-goal-collapse.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LONG =
  'Build a DAG Workflow Engine — a real, research-grade project, frontend/backend SEPARATED. ' +
  'Backend (Go + SQLite): workflows are a DAG with topological sort and cycle detection; an execution engine where a task runs only after all deps succeed, independent tasks run concurrently, configurable retries; persist defs and run state in SQLite; HTTP API for create/run/status; a real Go test suite. ' +
  'Frontend (Next.js + TypeScript): visualize the DAG nodes and edges plus live task status; a form to trigger a run; poll status and color nodes. Use the lsp tool to confirm no TS errors. Make it ACTUALLY RUN and pass its tests.'

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

await page.evaluate(async () => { for (const p of await window.api.project.list()) if ((p.title || '').includes('E2E goal collapse')) await window.api.project.remove(p.id) })
const proj = await page.evaluate(async (goal) => window.api.project.create({ title: 'E2E goal collapse', goal }), LONG)

// Open Projects fresh so the new card shows, then open its detail.
await page.evaluate(() => { document.querySelectorAll('.studio-nav-row').forEach((r) => { if (/Overview/i.test(r.textContent || '')) r.click() }) })
await page.waitForTimeout(300)
await page.evaluate(() => { document.querySelectorAll('.studio-nav-row').forEach((r) => { if (/Projects/i.test(r.textContent || '')) r.click() }) })
await page.waitForTimeout(800)
await page.evaluate((title) => { const c = [...document.querySelectorAll('.proj-card')].find((el) => el.textContent?.includes(title)); c?.click() }, 'E2E goal collapse')
await page.waitForTimeout(800)

const measure = () => page.evaluate(() => {
  const el = document.querySelector('.wb-goal')
  if (!el) return null
  const cs = getComputedStyle(el)
  return { h: el.offsetHeight, cls: el.className, clamp: cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp'), overflow: cs.overflow }
})
const collapsed = await measure()
await page.screenshot({ path: join(PROJECT, 'e2e', 'goal-collapsed.png') })
await page.evaluate(() => document.querySelector('.wb-goal')?.click())
await page.waitForTimeout(500)
const expanded = await measure()
await page.screenshot({ path: join(PROJECT, 'e2e', 'goal-expanded.png') })
// click again → back to collapsed
await page.evaluate(() => document.querySelector('.wb-goal')?.click())
await page.waitForTimeout(400)
const recollapsed = await measure()

await page.evaluate(async (id) => window.api.project.remove(id), proj.id)
await app.close()

console.log('collapsed:', JSON.stringify(collapsed))
console.log('expanded:', JSON.stringify(expanded))
console.log('recollapsed:', JSON.stringify(recollapsed))
const fails = []
if (!collapsed) fails.push('wb-goal not found in project detail')
else {
  if (!collapsed.cls.includes('collapsed')) fails.push('goal not collapsed by default')
  if (collapsed.clamp !== '3') fails.push(`line-clamp not 3 when collapsed: ${collapsed.clamp}`)
  if (expanded.cls.includes('collapsed')) fails.push('first click did not expand')
  if (!(expanded.h > collapsed.h)) fails.push(`expanded not taller: collapsed=${collapsed.h} expanded=${expanded.h}`)
  if (!recollapsed.cls.includes('collapsed')) fails.push('second click did not re-collapse')
}
console.log(fails.length ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ') : '\n✓ PASS — goal collapses to 3 lines; click expands to full height; click again re-collapses')
process.exit(fails.length ? 1 : 0)
