// Verifies the streaming "thinking" readout + composer width alignment.
//   - .input-dock-inner left/right edges line up with .msg-inner (composer as wide as the content),
//   - during streaming a .thinking-readout shows a role-colored dot (tr-breathe, NO spin) + verb,
//   - the avatar's .streaming class is now a visual no-op (animationName: none).
// MANUAL — sends one real chat turn. Relies on a configured studio.db (NS_KEY optional). Stable model
// via CHAT_MODEL (default gemini-2.5-flash) so streaming lasts long enough to sample the readout.
import { _electron } from 'playwright'
import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NS_KEY = process.env.NS_KEY || ''
const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-2.5-flash'

const errors = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stderr?.on('data', (d) => process.stderr.write('[main:err] ' + d.toString()))
const page = await app.firstWindow()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text())
})
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

// Backfill any missing key + bind generalist (plain chat — fastest path to a streaming state).
await page.evaluate(
  async ({ key, model }) => {
    const eps = await window.api.endpoints.list()
    for (const ep of eps) if (!ep.hasKey && key) await window.api.endpoints.update(ep.id, { apiKey: key })
    const gemini = (await window.api.endpoints.list()).find((e) => e.protocol === 'gemini')
    if (!gemini) throw new Error('need a gemini-protocol endpoint')
    await window.api.roles.setBinding('generalist', { endpointId: gemini.id, model })
  },
  { key: NS_KEY, model: CHAT_MODEL }
)
await page.evaluate(() => localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'generalist' })))
await page.reload()
await page.waitForTimeout(1500)

// ---- 1. composer width aligns with content (measured on the empty-state surface) ----
assert.ok(await page.$('textarea.cmp-textarea'), 'composer renders')
const w = await page.evaluate(() => {
  const mi = document.querySelector('.msg-inner')?.getBoundingClientRect()
  const di = document.querySelector('.input-dock-inner')?.getBoundingClientRect()
  if (!mi || !di) return null
  return { miL: mi.left, miR: mi.right, miW: mi.width, diL: di.left, diR: di.right, diW: di.width }
})
console.log('widths:', JSON.stringify(w))
assert.ok(w, '.msg-inner + .input-dock-inner both present')
assert.ok(Math.abs(w.miL - w.diL) < 1.5, `left edges align (content=${w.miL.toFixed(1)} composer=${w.diL.toFixed(1)})`)
assert.ok(Math.abs(w.miR - w.diR) < 1.5, `right edges align (content=${w.miR.toFixed(1)} composer=${w.diR.toFixed(1)})`)
assert.ok(Math.abs(w.miW - w.diW) < 1.5, `widths match (content=${w.miW.toFixed(1)} composer=${w.diW.toFixed(1)})`)
console.log('✓ composer width aligns with content')

// ---- 2. streaming thinking readout ----
await page.fill('textarea.cmp-textarea', 'Write a vivid 30-line poem about the four seasons. Take your time.')
await page.waitForTimeout(150)
await page.keyboard.press('Enter')
await page.waitForSelector('.cmp-stop', { timeout: 20000 }) // streaming started
await page.waitForSelector('.thinking-readout', { timeout: 8000 })
const r = await page.evaluate(() => {
  const el = document.querySelector('.thinking-readout')
  if (!el) return null
  const dot = el.querySelector('.tr-dot')
  const verbEl = el.querySelector('.tr-verb')
  const dotCs = dot ? getComputedStyle(dot) : null
  const av = document.querySelector('.avatar.streaming')
  return {
    text: el.textContent?.trim(),
    verb: verbEl?.textContent,
    dotBg: dotCs?.backgroundColor,
    dotAnim: dotCs?.animationName,
    dotTransform: dotCs?.transform,
    marginTop: getComputedStyle(el).marginTop,
    avatarAnim: av ? getComputedStyle(av).animationName : 'no-streaming-avatar'
  }
})
console.log('readout:', JSON.stringify(r))
await page.screenshot({ path: '/tmp/thinking-readout.png', fullPage: true })
assert.ok(r, '.thinking-readout renders while streaming')
assert.ok(r.verb && r.verb.endsWith('…'), `action verb shown (${r.verb})`)
assert.equal(r.dotAnim, 'tr-breathe', 'dot breathes (no spin/scale keyframe)')
assert.ok(r.dotTransform === 'none' || r.dotTransform === 'matrix(1, 0, 0, 1, 0, 0)', `dot not transformed (${r.dotTransform})`)
assert.ok(r.dotBg && r.dotBg !== 'rgba(0, 0, 0, 0)', `dot has a role color (${r.dotBg})`)
assert.ok(r.avatarAnim === 'none' || r.avatarAnim === 'no-streaming-avatar', `avatar no longer pulses (${r.avatarAnim})`)
assert.equal(r.marginTop, '10px', `readout sits a little below the content (marginTop ${r.marginTop})`)
console.log('✓ thinking readout: dot+verb, breathing not spinning, avatar static, 10px gap above')

// Wait until the model emits body text so the readout shows the full "verb · elapsed · ↓ tokens".
await page
  .waitForFunction(() => (document.querySelector('.thinking-readout')?.textContent ?? '').includes('tokens'), { timeout: 18000 })
  .catch(() => {})
const full = await page.evaluate(() => document.querySelector('.thinking-readout')?.textContent?.trim() ?? '(streaming ended)')
console.log('full readout:', JSON.stringify(full))
await page.screenshot({ path: '/tmp/thinking-readout-full.png', fullPage: true })

// let the turn finish for a clean final frame
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000)
  if (!(await page.$('.cmp-stop'))) break
}
await page.screenshot({ path: '/tmp/thinking-done.png', fullPage: true })

console.log(errors.length ? '✗ page errors: ' + JSON.stringify(errors) : '✓ no page errors')
await app.close()
process.exit(errors.length ? 1 : 0)
