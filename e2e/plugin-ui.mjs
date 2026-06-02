// Stage-C verify: Extensions → Plugins tab is real. Empty state, install a plugin (skill + role) via
// the dialog (dirPath typed — no native picker in e2e), assert the plugin row + bundle chips + summary,
// that the owned skill shows "via <plugin>" + locked in the Skills tab, and that Uninstall cascades.
// No LLM. Run: node e2e/plugin-ui.mjs
import { _electron } from 'playwright'
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = mkdtempSync(join(tmpdir(), 'nsai-plugin-ui-'))
const plugDir = join(root, 'starter-pack')
mkdirSync(join(plugDir, '.claude-plugin'), { recursive: true })
mkdirSync(join(plugDir, 'skills', 'code-review'), { recursive: true })
writeFileSync(join(plugDir, 'skills', 'code-review', 'SKILL.md'), '---\nname: code-review\ndescription: Structured PR review\n---\nReview the diff.')
writeFileSync(
  join(plugDir, '.claude-plugin', 'plugin.json'),
  JSON.stringify({ name: 'starter-pack', version: '2.1.0', description: 'A starter bundle', roles: [{ name: 'Reviewer', systemPrompt: 'Review.' }] })
)

const errors = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stderr?.on('data', (d) => process.stderr.write('[main:err] ' + d.toString()))
const page = await app.firstWindow()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text())
})
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(800)

await page.evaluate(async () => {
  for (const p of await window.api.plugins.list()) await window.api.plugins.uninstall(p.id)
  for (const s of await window.api.skills.list()) await window.api.skills.remove(s.id)
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'extensions' }))
})
await page.reload()
await page.waitForTimeout(1200)

await page.click('.studio-tabs button:has-text("Plugins")')
await page.waitForTimeout(300)
assert.ok(await page.$('.ext-empty'), 'empty state when no plugins')
console.log('✓ Plugins tab + empty state')

// Install via dialog.
await page.click('button:has-text("Install plugin")')
await page.waitForSelector('.dialog')
await page.fill('.dialog input[placeholder="/path/to/plugin"]', plugDir)
await page.click('.dialog .btn.primary')
await page.waitForTimeout(900)
const row = await page.evaluate(() => {
  const r = [...document.querySelectorAll('.ext-row.plugin')].find((el) => el.querySelector('.ext-name')?.textContent === 'starter-pack')
  if (!r) return null
  return {
    name: r.querySelector('.ext-name')?.textContent,
    version: (r.querySelector('.ext-source')?.textContent || '').trim(),
    chips: [...r.querySelectorAll('.bundle-chip')].map((c) => (c.textContent || '').trim()),
    summary: (r.querySelector('.ext-summary')?.textContent || '').trim()
  }
})
console.log('plugin row:', JSON.stringify(row))
assert.ok(row, 'plugin row rendered')
assert.equal(row.name, 'starter-pack')
assert.equal(row.version, 'v2.1.0')
assert.ok(row.chips.some((c) => c.includes('code-review')), 'skill bundle chip')
assert.ok(row.chips.some((c) => c.includes('Reviewer')), 'role bundle chip')
assert.ok(/skill/.test(row.summary) && /role/.test(row.summary), `summary lists components (got ${row.summary})`)
console.log('✓ installed via dialog — row + bundle chips + summary')

// Skills tab: the plugin-owned skill is marked "via" + locked.
await page.click('.studio-tabs button:has-text("Skills")')
await page.waitForTimeout(300)
const owned = await page.evaluate(() => {
  const r = [...document.querySelectorAll('.ext-row')].find((el) => el.querySelector('.ext-name')?.textContent === 'code-review')
  if (!r) return null
  return {
    via: (r.querySelector('.ext-owned')?.textContent || '').trim(),
    toggleLocked: !!r.querySelector('.switch.disabled'),
    hasMenu: !!r.querySelector('.ext-more')
  }
})
console.log('owned skill:', JSON.stringify(owned))
assert.ok(owned, 'plugin skill appears in Skills tab')
assert.ok(owned.via.includes('starter-pack'), 'marked "via starter-pack"')
assert.ok(owned.toggleLocked, 'toggle locked (disabled)')
assert.ok(!owned.hasMenu, 'no ⋯ menu (locked — managed from Plugins)')
console.log('✓ owned skill marked via plugin + locked in Skills tab')

await page.screenshot({ path: '/tmp/plugin-ui.png', fullPage: true })

// Uninstall cascades.
await page.click('.studio-tabs button:has-text("Plugins")')
await page.waitForTimeout(300)
await page.click('.ext-row.plugin .ext-more')
await page.click('.row-menu .rm-item.danger')
await page.waitForTimeout(600)
assert.ok(await page.$('.ext-empty'), 'empty after uninstall')
const skillsLeft = await page.evaluate(() => window.api.skills.list().then((s) => s.length))
assert.equal(skillsLeft, 0, 'owned skill removed with the plugin')
console.log('✓ uninstall cascaded (plugin + owned skill gone)')

rmSync(root, { recursive: true, force: true })
console.log(errors.length ? '✗ page errors: ' + JSON.stringify(errors) : '✓ no page errors')
await app.close()
process.exit(errors.length ? 1 : 0)
