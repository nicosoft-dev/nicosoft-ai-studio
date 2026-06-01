// UI smoke test — boots the real Electron app (production build), drives a few screens, and fails on
// any JS error or missing key UI. Read-only: no LLM, no network, safe to run anytime.
//   npm run build && node e2e/smoke.mjs
import { _electron } from 'playwright'
import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text())
})
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1200)

// Engineer renders via the unified ChatView (no more EngineerAgentView).
await page.evaluate(() =>
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'engineer' }))
)
await page.reload()
await page.waitForTimeout(2000)
const engineerText = await page.evaluate(() => document.body.innerText)
assert.ok(engineerText.includes('Flynn'), 'Flynn (engineer) view should render')
assert.ok(await page.$('textarea.cmp-textarea'), 'composer textarea should render')

// Memory settings page renders real per-role self-learning.
await page.evaluate(() =>
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'settings', settingsTab: 'memory' }))
)
await page.reload()
await page.waitForTimeout(1500)
const memText = await page.evaluate(() => document.body.innerText)
assert.ok(memText.includes('Self-learning'), 'Memory settings should render')

assert.equal(errors.length, 0, 'no JS errors expected:\n' + errors.join('\n'))
await app.close()
console.log('✓ smoke OK (no JS errors, Engineer + Memory render)')
