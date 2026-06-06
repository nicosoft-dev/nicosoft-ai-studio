// Test point 1 (state integrity half): independent per-role sessions survive switching experts back and
// forth — no data loss, no cross-conversation bleed, reopen is faithful. Deterministic (no LLM): we seed
// two conversations (generalist + translator) with unique markers via the API, then drive the REAL sidebar
// switching (role-row clicks = selectExpert, hist-row clicks = selectConv) and assert integrity at each step.
// Also REPORTS the switch-back UX (does returning to an expert restore its last conversation, or open a
// blank one) — that's a design call to confirm, not necessarily a bug.
//   node e2e/verify-session-switch.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

// --- seed two conversations with unique markers, no LLM ---
const ids = await page.evaluate(async () => {
  for (const c of await window.api.conversations.list()) if ((c.title ?? '').startsWith('SwitchTest')) await window.api.conversations.remove(c.id)
  const g = await window.api.conversations.create({ kind: 'single', primaryRoleId: 'generalist', title: 'SwitchTest G' })
  await window.api.conversations.append(g.id, { author: 'user', expertId: 'generalist', content: 'hello to G' })
  await window.api.conversations.append(g.id, { author: 'expert', expertId: 'generalist', content: 'ALPHA-MARKER-G is the reply' })
  const t = await window.api.conversations.create({ kind: 'single', primaryRoleId: 'translator', title: 'SwitchTest T' })
  await window.api.conversations.append(t.id, { author: 'user', expertId: 'translator', content: 'hello to T' })
  await window.api.conversations.append(t.id, { author: 'expert', expertId: 'translator', content: 'BETA-MARKER-T is the reply' })
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'generalist' }))
  return { g: g.id, t: t.id }
})
await page.reload()
await page.waitForTimeout(1500)

const dom = () =>
  page.evaluate(() => ({
    msgs: document.querySelector('.msg-list')?.innerText ?? '',
    activeConv: document.querySelector('.hist-row.active .hist-title')?.textContent ?? '(none)'
  }))

const steps = []
// 1. open conv-G from History
await page.locator('.hist-row', { hasText: 'SwitchTest G' }).first().click()
await page.waitForTimeout(600)
const openG = await dom()
steps.push(['open conv-G', openG.activeConv, openG.msgs.includes('ALPHA-MARKER-G')])

// 2. switch to a DIFFERENT expert (translator / Louise) via its sidebar row
await page.locator('.role-row', { hasText: 'Louise' }).locator('.role-meta').first().click()
await page.waitForTimeout(600)
const switchT = await dom()

// 3. switch back to generalist (Amélie)
await page.locator('.role-row', { hasText: 'Amélie' }).locator('.role-meta').first().click()
await page.waitForTimeout(600)
const backG = await dom()

// 4. DATA INTEGRITY — both convs still exist, markers intact, no cross-bleed
const integ = await page.evaluate(async (ids) => {
  const list = await window.api.conversations.list()
  const gMsgs = (await window.api.conversations.messages(ids.g)).map((m) => m.content).join(' | ')
  const tMsgs = (await window.api.conversations.messages(ids.t)).map((m) => m.content).join(' | ')
  return {
    gExists: list.some((c) => c.id === ids.g),
    tExists: list.some((c) => c.id === ids.t),
    gHasAlpha: gMsgs.includes('ALPHA-MARKER-G'),
    gHasBeta: gMsgs.includes('BETA-MARKER-T'),
    tHasBeta: tMsgs.includes('BETA-MARKER-T'),
    tHasAlpha: tMsgs.includes('ALPHA-MARKER-G')
  }
}, ids)

// 5. reopen conv-G — faithful?
await page.locator('.hist-row', { hasText: 'SwitchTest G' }).first().click()
await page.waitForTimeout(600)
const reopenG = await dom()

// cleanup
await page.evaluate(async (ids) => { await window.api.conversations.remove(ids.g); await window.api.conversations.remove(ids.t) }, ids)
await app.close()

console.log('open conv-G        → active:', openG.activeConv, '| ALPHA shown:', openG.msgs.includes('ALPHA-MARKER-G'))
console.log('switch → Louise    → active:', switchT.activeConv, '| BETA shown:', switchT.msgs.includes('BETA-MARKER-T'))
console.log('switch back Amélie → active:', backG.activeConv, '| ALPHA shown:', backG.msgs.includes('ALPHA-MARKER-G'))
console.log('reopen conv-G      → active:', reopenG.activeConv, '| ALPHA shown:', reopenG.msgs.includes('ALPHA-MARKER-G'))
console.log('integrity:', JSON.stringify(integ))

const fails = []
// Data integrity: no loss, no cross-conversation bleed, reopen faithful.
if (!integ.gExists || !integ.tExists) fails.push('a conversation was lost from the list after switching')
if (!integ.gHasAlpha || !integ.tHasBeta) fails.push('a conversation lost its own message after switching')
if (integ.gHasBeta || integ.tHasAlpha) fails.push('CROSS-BLEED: a conversation picked up the other one\'s message')
if (!openG.msgs.includes('ALPHA-MARKER-G')) fails.push('opening conv-G did not render its message')
if (!reopenG.msgs.includes('ALPHA-MARKER-G')) fails.push('reopening conv-G did not render its message')
// Switch RESTORE (the fix): switching to an expert reopens its most-recent conversation, not a blank one.
if (!switchT.msgs.includes('BETA-MARKER-T')) fails.push('switching to Louise did NOT restore her most-recent conversation (conv-T / BETA)')
if (switchT.msgs.includes('ALPHA-MARKER-G')) fails.push('switching to Louise showed GENERALIST content (wrong conversation restored)')
if (!backG.msgs.includes('ALPHA-MARKER-G')) fails.push('switching back to Amélie did NOT restore her most-recent conversation (conv-G / ALPHA) — still blanking')

console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : '\n✓ PASS — switching to an expert RESTORES its most-recent conversation (Louise→conv-T, back→conv-G); sessions stay isolated + durable, no data loss / cross-bleed'
)
process.exit(fails.length ? 1 : 0)
