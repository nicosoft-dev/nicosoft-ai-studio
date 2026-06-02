// Verifies Batch 6 Tools tab: Extensions has a 4th "Tools" tab (MCP · Skills · Plugins · Tools) with the
// Generate Image built-in-tool card — ns_generate_image label, description, scope = Georgia (designer),
// an ON enable toggle, and a Default model picker. Also checks the toggle persists to settings (real,
// not mock). No LLM needed. Restores the toggle to ON at the end (off would disable designer image gen).
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text())
})
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

// Jump straight to the Extensions view.
await page.evaluate(() => localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'extensions' })))
await page.reload()
await page.waitForTimeout(1500)

// 1) Four tabs, Tools is the 4th.
const tabs = await page.$$eval('.studio-tabs button', (els) => els.map((e) => (e.textContent || '').trim()))
console.log('tabs:', JSON.stringify(tabs))
assert.deepEqual(tabs, ['MCP', 'Skills', 'Plugins', 'Tools'], `expected MCP·Skills·Plugins·Tools, got ${JSON.stringify(tabs)}`)
console.log('✓ Tools is the 4th Extensions tab')

// 2) Open Tools → Generate Image card.
await page.click('.studio-tabs button:has-text("Tools")')
await page.waitForTimeout(500)
const card = await page.evaluate(() => {
  const row = document.querySelector('.ext-row.tool')
  if (!row) return null
  return {
    name: (row.querySelector('.ext-name:not(.mono)')?.textContent || '').trim(),
    toolId: (row.querySelector('.ext-name.mono')?.textContent || '').trim(),
    desc: (row.querySelector('.ext-line2')?.textContent || '').trim(),
    pickerLabel: (row.querySelector('.cmp-model-id')?.textContent || '').trim(),
    scope: (row.querySelector('.scope-chip')?.textContent || '').trim(),
    toggleOn: row.querySelector('.switch')?.classList.contains('on') ?? false
  }
})
console.log('card:', JSON.stringify(card))
assert.ok(card, 'Generate Image card renders')
assert.equal(card.name, 'Generate Image', 'card title')
assert.equal(card.toolId, 'ns_generate_image', 'mono tool id')
assert.ok(/posters/i.test(card.desc), `description (got ${card.desc})`)
assert.ok(card.pickerLabel.length > 0, `Default model picker shows a backend (got "${card.pickerLabel}")`)
assert.ok(/Georgia/i.test(card.scope), `scope shows Georgia (got "${card.scope}")`)
assert.ok(card.toggleOn, 'enable toggle is ON')
console.log(`✓ card: ns_generate_image · default="${card.pickerLabel}" · scope=Georgia · toggle=ON`)

// 3) Toggle persists to settings (real, not mock).
await page.click('.ext-row.tool .switch')
await page.waitForTimeout(300)
const off = await page.evaluate(() => window.api.settings.get('tools.generate_image.enabled'))
console.log('after toggle off, settings:', off)
assert.equal(off, false, 'toggle off persisted (tools.generate_image.enabled=false)')
// Restore ON — off would disable designer image generation for real.
await page.click('.ext-row.tool .switch')
await page.waitForTimeout(300)
const on = await page.evaluate(() => window.api.settings.get('tools.generate_image.enabled'))
assert.equal(on, true, 'toggle restored to ON')
console.log('✓ toggle persists to settings (real) + restored to ON')

await page.screenshot({ path: '/tmp/tools-tab.png', fullPage: true })
console.log(errors.length ? '✗ page errors: ' + JSON.stringify(errors) : '✓ no page errors')
await app.close()
process.exit(errors.length ? 1 : 0)
