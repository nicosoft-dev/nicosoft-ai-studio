// Robustness: the DEFAULT-mode approval gate. A mutating tool (Write) must PAUSE for the permission dialog;
// Allow lets it run (file lands, run completes); a later Deny must be handled gracefully (no wedge — the
// conversation stays usable). Every other agent e2e runs in bypass (auto-approve), so this is the only test
// of the interactive gate + the dialog lifecycle. MANUAL — real LLM. SKIPs if engineer isn't bound+keyed.
//   node e2e/verify-approval-flow.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/e2e-approval'
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
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ engineer: 'default' })) // gate ON
  return { ok: true }
}, CWD)
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP — engineer not bound to a keyed endpoint'); await app.close(); rmSync(CWD, { recursive: true, force: true }); process.exit(0) }
await page.reload()
await page.waitForTimeout(1500)

// --- ALLOW path ---
await page.fill('textarea.cmp-textarea', 'Create a file named note.txt containing exactly the single word banana. Use the Write tool.')
await page.keyboard.press('Enter')
// wait for the permission dialog to appear (the gate paused the run)
let dialogAppeared = false
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000)
  if (await page.$('.ap-allow')) { dialogAppeared = true; break }
  if (!(await page.$('.cmp-stop')) && i > 3) break // run ended without ever asking
}
if (dialogAppeared) await page.$eval('.ap-allow', (e) => e.click())
for (let i = 0; i < 30; i++) { await page.waitForTimeout(1500); if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click()); if (!(await page.$('.cmp-stop')) && i > 1) break }
await page.waitForTimeout(1000)
const fileWritten = existsSync(join(CWD, 'note.txt')) && /banana/i.test(readFileSync(join(CWD, 'note.txt'), 'utf8'))

// --- DENY path: a second mutating task, deny it, conversation must stay usable ---
await page.fill('textarea.cmp-textarea', 'Now overwrite note.txt with the word apple instead. Use Write.')
await page.keyboard.press('Enter')
let denyDialog = false
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(1000)
  if (await page.$('.ap-deny')) { denyDialog = true; break }
  if (!(await page.$('.cmp-stop')) && i > 3) break
}
if (denyDialog) await page.$eval('.ap-deny', (e) => e.click())
for (let i = 0; i < 20; i++) { await page.waitForTimeout(1500); if (!(await page.$('.cmp-stop')) && i > 1) break }
await page.waitForTimeout(1000)
const afterDeny = await page.evaluate(() => ({
  stuckReadout: !!document.querySelector('.thinking-readout'),
  canType: !document.querySelector('textarea.cmp-textarea')?.disabled,
  noDialog: !document.querySelector('.ap-allow') && !document.querySelector('.ap-deny')
}))
const fileAfterDeny = existsSync(join(CWD, 'note.txt')) ? readFileSync(join(CWD, 'note.txt'), 'utf8') : ''

await page.evaluate(async () => { for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'engineer')) await window.api.conversations.remove(c.id) })
await app.close()
rmSync(CWD, { recursive: true, force: true })

console.log('ALLOW: dialog appeared:', dialogAppeared, '| file written (banana):', fileWritten)
console.log('DENY: dialog appeared:', denyDialog, '| after deny:', JSON.stringify(afterDeny), '| file still:', JSON.stringify(fileAfterDeny.trim()))

const fails = []
if (!dialogAppeared) fails.push('the Write tool did NOT pause for approval in default mode — the permission gate is not firing')
if (!fileWritten) fails.push('after Allow, note.txt was not written with "banana" — approve did not let the tool run')
if (denyDialog) {
  if (afterDeny.stuckReadout) fails.push('readout stuck after Deny')
  if (!afterDeny.canType || !afterDeny.noDialog) fails.push('conversation wedged after Deny (composer disabled or dialog stuck)')
  if (/apple/i.test(fileAfterDeny)) fails.push('Deny did not block the write — file was overwritten with apple anyway')
}
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : `\n✓ PASS — default-mode approval gate works: Write paused for the dialog, Allow let it write note.txt${denyDialog ? ', Deny blocked the overwrite and left the conversation usable' : ' (deny round skipped — model did not retry a write)'}`
)
process.exit(fails.length ? 1 : 0)
