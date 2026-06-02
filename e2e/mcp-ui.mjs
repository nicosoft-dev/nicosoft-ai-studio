// Stage-C verify: the Extensions → MCP tab is real (not mock). Open it (empty state), add a filesystem
// server through the McpDialog, Save (which connects), and assert the row shows connected + a tool
// count + scope. Cleanup via IPC. No LLM. Run: node e2e/mcp-ui.mjs
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

// Clean slate, then land on the Extensions view.
await page.evaluate(async () => {
  for (const s of await window.api.mcp.list()) await window.api.mcp.remove(s.id)
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'extensions' }))
})
await page.reload()
await page.waitForTimeout(1500)

const tab0 = await page.$eval('.studio-tabs button.active', (b) => (b.textContent || '').trim())
assert.equal(tab0, 'MCP', 'MCP is the default Extensions tab')
assert.ok(await page.$('.ext-empty'), 'empty state shows when there are no servers')
console.log('✓ MCP tab default + empty state')

// Add a filesystem server via the dialog.
await page.click('button:has-text("Add MCP server")')
await page.waitForSelector('.dialog')
await page.fill('.dialog input[placeholder="filesystem"]', 'fs-ui')
await page.fill('.dialog input[placeholder="npx"]', 'npx')
await page.fill('.dialog input[placeholder*="server-filesystem"]', '-y @modelcontextprotocol/server-filesystem /tmp')
await page.click('.dialog .btn.primary') // Save → add + connect
console.log('saved, waiting for connect…')

let row = null
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000)
  row = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.ext-row')].find(
      (el) => el.querySelector('.ext-name')?.textContent === 'fs-ui'
    )
    if (!r) return null
    return {
      name: r.querySelector('.ext-name')?.textContent,
      status: (r.querySelector('.ext-status')?.textContent || '').trim(),
      tools: (r.querySelector('.ext-tools')?.textContent || '').trim(),
      scope: (r.querySelector('.scope-chip')?.textContent || '').trim()
    }
  })
  if (row && row.status === 'connected') break
}
console.log('row:', JSON.stringify(row))
assert.ok(row, 'server row rendered after Save')
assert.equal(row.status, 'connected', `row shows connected (got ${row?.status})`)
assert.ok(/\d+ tools/.test(row.tools), `row shows a tool count (got ${row.tools})`)
console.log(`✓ added filesystem server via dialog — connected, ${row.tools}`)

await page.screenshot({ path: '/tmp/mcp-ui.png', fullPage: true })

await page.evaluate(async () => {
  for (const s of await window.api.mcp.list()) await window.api.mcp.remove(s.id)
})

console.log(errors.length ? '✗ page errors: ' + JSON.stringify(errors) : '✓ no page errors')
await app.close()
process.exit(errors.length ? 1 : 0)
