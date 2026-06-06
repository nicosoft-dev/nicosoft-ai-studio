// Verify the Workspace drawer shows REAL per-conversation data (replacing the old mock): Files = files the
// agent produced (Write/WritePdf/Edit), Tasks = the agent's TodoWrite list, both derived from the
// conversation's transcript; Recent images from message attachments. We run engineer on a task that writes a
// file AND keeps a todo list, open the drawer, and assert the produced file + the task list show up.
// MANUAL — real LLM. SKIPs if engineer isn't bound to a keyed endpoint.
//   node e2e/verify-workspace-drawer.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, existsSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/e2e-workspace'
rmSync(CWD, { recursive: true, force: true })
mkdirSync(CWD, { recursive: true })

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async (cwd) => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'engineer')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'engineer')) await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'engineer' }))
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ engineer: cwd }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ engineer: 'bypass' }))
  return { ok: true }
}, CWD)
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP — engineer not bound to a keyed endpoint'); await app.close(); rmSync(CWD, { recursive: true, force: true }); process.exit(0) }
await page.reload()
await page.waitForTimeout(1500)

await page.fill(
  'textarea.cmp-textarea',
  'First call the TodoWrite tool to lay out your steps as a todo list, then create a file named gotips.txt containing three short tips about Go error handling, then mark the todos done.'
)
await page.keyboard.press('Enter')
console.log('engineer: TodoWrite + write gotips.txt ...')
for (let i = 0; i < 50; i++) {
  await page.waitForTimeout(2000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
  if (!(await page.$('.cmp-stop')) && i > 2) break
}
await page.waitForTimeout(1000)

const fileWritten = existsSync(join(CWD, 'gotips.txt'))

// open the Workspace drawer
await page.$eval('button[title="Workspace"]', (e) => e.click())
await page.waitForTimeout(800)

const probe = await page.evaluate(() => {
  const drawer = document.querySelector('.workspace-drawer')
  if (!drawer) return { drawer: false }
  const files = [...document.querySelectorAll('.ws-files .wf-name')].map((e) => e.textContent)
  const tasks = [...document.querySelectorAll('.ws-tasks .ws-task-label')].map((e) => e.textContent)
  const sections = [...document.querySelectorAll('.ws-section-head')].map((e) => e.textContent)
  const imagesEmpty = !!document.querySelector('.ws-images') ? false : !![...document.querySelectorAll('.ws-empty')].length
  return { drawer: true, files, tasks, sections, imagesEmpty }
})
await page.screenshot({ path: '/tmp/e2e-workspace/drawer.png' })

await page.evaluate(async () => { for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'engineer')) await window.api.conversations.remove(c.id) })
await app.close()

console.log('file gotips.txt written:', fileWritten)
console.log('drawer sections:', JSON.stringify(probe.sections))
console.log('Files:', JSON.stringify(probe.files))
console.log('Tasks:', JSON.stringify(probe.tasks))
console.log('screenshot: /tmp/e2e-workspace/drawer.png (saved before cleanup)')

const fails = []
if (!probe.drawer) fails.push('workspace drawer did not open')
else {
  const wantSections = ['Files', 'Recent images', 'Tasks']
  if (!wantSections.every((s) => probe.sections?.includes(s))) fails.push(`drawer missing a section — got ${JSON.stringify(probe.sections)}`)
  if (!fileWritten) fails.push('engineer never wrote gotips.txt (cannot verify Files section)')
  else if (!(probe.files ?? []).some((f) => (f ?? '').includes('gotips.txt'))) fails.push('Files section did NOT list the produced gotips.txt')
  if (!(probe.tasks ?? []).length) fails.push('Tasks section empty — engineer did not use TodoWrite (re-run) OR the TodoWrite→Tasks wiring is broken')
}
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : `\n✓ PASS — Workspace drawer shows real data: Files lists the produced gotips.txt, Tasks shows ${probe.tasks.length} TodoWrite item(s), all 3 sections render`
)
process.exit(fails.length ? 1 : 0)
