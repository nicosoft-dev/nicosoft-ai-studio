// Robustness: when a run ERRORS (here: a bogus model the upstream rejects), the failure must surface
// cleanly — no stuck spinner / readout, no wedged conversation — and the SAME conversation must recover
// once the cause is fixed (a follow-up message succeeds). Error paths are as bug-prone as cancel paths.
// MANUAL — real LLM. SKIPs if generalist isn't bound to a keyed endpoint. Restores the binding always.
//   node e2e/verify-error-recovery.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DB = join(homedir(), '.nsai', 'studio.db')
const restoreSql = (model) => { try { execFileSync('sqlite3', [DB, `UPDATE role_bindings SET model='${model}' WHERE role_id='generalist';`]) } catch (e) { console.log('WARN restore:', e.message) } }

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async () => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'generalist')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'generalist')) await window.api.conversations.remove(c.id)
  const orig = b.model
  await window.api.roles.setBinding('generalist', { endpointId: b.endpointId, model: 'nonexistent-bogus-model-zzz', thinkingDepth: b.thinkingDepth ?? null, imageModel: b.imageModel ?? null })
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'generalist' }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ generalist: 'bypass' }))
  return { ok: true, orig, endpointId: b.endpointId, thinkingDepth: b.thinkingDepth ?? null, imageModel: b.imageModel ?? null }
})
console.log('setup:', JSON.stringify({ ok: setup.ok, orig: setup.orig }))
if (!setup.ok) { console.log('SKIP — generalist not bound to a keyed endpoint'); await app.close(); process.exit(0) }
await page.reload()
await page.waitForTimeout(1500)

let crashed = false
let afterError = {}, recovered = {}
try {
  // 1. send with the bogus model → expect a clean error
  await page.fill('textarea.cmp-textarea', 'Hello, are you there?')
  await page.keyboard.press('Enter')
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(1000); if (!(await page.$('.cmp-stop')) && i > 1) break }
  await page.waitForTimeout(1500)
  afterError = await page.evaluate(() => ({
    stuckStop: !!document.querySelector('.cmp-stop'),
    stuckReadout: !!document.querySelector('.thinking-readout'),
    errorShown: !!document.querySelector('.inline-notice'), // the error banner (alert icon + message)
    canType: !document.querySelector('textarea.cmp-textarea')?.disabled
  }))

  // 2. fix the model + reload (so the renderer's role-binding picks up the good model, like the UI picker
  //    would), then send again → the app must recover and produce a reply.
  await page.evaluate((s) => window.api.roles.setBinding('generalist', { endpointId: s.endpointId, model: s.orig, thinkingDepth: s.thinkingDepth, imageModel: s.imageModel }), setup)
  await page.reload()
  await page.waitForTimeout(1500)
  await page.fill('textarea.cmp-textarea', 'Reply with exactly: RECOVERED-OK')
  await page.keyboard.press('Enter')
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(1500); if (!(await page.$('.cmp-stop')) && i > 1) break }
  await page.waitForTimeout(800)
  recovered = await page.evaluate(async () => {
    const convs = (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'generalist')
    for (const c of convs) {
      const a = (await window.api.conversations.messages(c.id)).filter((m) => m.author !== 'user')
      if (a.some((m) => (m.content ?? '').length > 0)) return { found: true, reply: true }
    }
    return { found: convs.length > 0, reply: false }
  })
} catch (e) { crashed = true; console.log('ERROR during run:', e.message) } finally {
  try { await page.evaluate((s) => window.api.roles.setBinding('generalist', { endpointId: s.endpointId, model: s.orig, thinkingDepth: s.thinkingDepth, imageModel: s.imageModel }), setup) } catch { restoreSql(setup.orig) }
  try { await page.evaluate(async () => { for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'generalist')) await window.api.conversations.remove(c.id) }) } catch { /* */ }
  await app.close().catch(() => {})
}

console.log('after error:', JSON.stringify(afterError))
console.log('recovered:', JSON.stringify(recovered))

const fails = []
if (crashed) fails.push('test crashed')
if (afterError.stuckStop) fails.push('stop button stuck after error (streaming flag never cleared)')
if (afterError.stuckReadout) fails.push('thinking readout stuck after error — still counting on a dead run')
if (!afterError.canType) fails.push('composer disabled after error — conversation wedged')
if (!afterError.errorShown) fails.push('the error was not surfaced to the user (silent failure)')
if (!recovered.found || !recovered.reply) fails.push('conversation did NOT recover — a follow-up after fixing the model produced no reply')
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : '\n✓ PASS — a run error surfaces cleanly (no stuck spinner/readout, error shown, composer usable) and the conversation recovers: the next message succeeds'
)
process.exit(fails.length ? 1 : 0)
