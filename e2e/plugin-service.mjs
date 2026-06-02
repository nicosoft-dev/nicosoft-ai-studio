// Stage-B verify for plugins: drive the real IPC (window.api.plugins) inside Electron. Install a plugin
// directory bundling a skill + an MCP server + a custom role, assert all three register owned by the
// plugin, that enable/disable cascades onto the owned skill+mcp, that uninstall cascades the deletes,
// and that a bad directory rejects. Real DB + services; no LLM. Run: node e2e/plugin-service.mjs
import { _electron } from 'playwright'
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = mkdtempSync(join(tmpdir(), 'nsai-plugin-b-'))
const plugDir = join(root, 'dev-pack')
mkdirSync(join(plugDir, '.claude-plugin'), { recursive: true })
mkdirSync(join(plugDir, 'skills', 'code-review'), { recursive: true })
writeFileSync(
  join(plugDir, 'skills', 'code-review', 'SKILL.md'),
  '---\nname: code-review\ndescription: Structured PR review\nwhen_to_use: reviewing a diff\n---\nReview carefully.'
)
writeFileSync(
  join(plugDir, '.claude-plugin', 'plugin.json'),
  JSON.stringify({
    name: 'dev-pack', version: '1.0.0', description: 'Dev tools', author: 'nico',
    mcpServers: { fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] } },
    roles: [{ name: 'Reviewer', systemPrompt: 'Review code.', greeting: 'Hi' }]
  })
)
const badDir = join(root, 'bad')
mkdirSync(badDir) // no plugin.json

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
  for (const m of await window.api.mcp.list()) await window.api.mcp.remove(m.id)
})

// 1) install — bundles a skill + mcp + role.
const plugin = await page.evaluate((dir) => window.api.plugins.install(dir), plugDir)
console.log('installed:', JSON.stringify(plugin))
assert.equal(plugin.name, 'dev-pack')
assert.equal(plugin.version, '1.0.0')
assert.deepEqual(plugin.bundles.map((b) => b.type).sort(), ['mcp', 'role', 'skill'], 'all three component types bundled')
console.log('✓ install bundled skill + mcp + role')

// 2) owned skill/mcp carry owner_plugin_id; the role exists.
const state = await page.evaluate(async (pid) => {
  const skills = await window.api.skills.list()
  const mcp = await window.api.mcp.list()
  const roles = await window.api.roles.listCustom()
  return {
    skill: skills.find((s) => s.ownerPluginId === pid) ?? null,
    mcp: mcp.find((m) => m.ownerPluginId === pid) ?? null,
    role: roles.find((r) => r.name === 'Reviewer') ?? null
  }
}, plugin.id)
assert.ok(state.skill && state.skill.name === 'code-review', 'skill installed + owned')
assert.ok(state.mcp && state.mcp.name === 'fs', 'mcp installed + owned')
assert.ok(state.role, 'custom role installed')
console.log('✓ skill + mcp owned by plugin, role created')

// 3) disable cascades onto owned skill + mcp (check the enabled flag, not connect status).
await page.evaluate((id) => window.api.plugins.toggle(id, false), plugin.id)
const off = await page.evaluate(async (pid) => {
  const skills = await window.api.skills.list()
  const mcp = await window.api.mcp.list()
  return { skill: skills.find((s) => s.ownerPluginId === pid)?.enabled, mcp: mcp.find((m) => m.ownerPluginId === pid)?.enabled }
}, plugin.id)
assert.equal(off.skill, false, 'owned skill disabled')
assert.equal(off.mcp, false, 'owned mcp disabled')
console.log('✓ disable plugin → owned skill + mcp disabled')

// 4) enable re-enables.
await page.evaluate((id) => window.api.plugins.toggle(id, true), plugin.id)
const on = await page.evaluate(async (pid) => {
  const skills = await window.api.skills.list()
  return skills.find((s) => s.ownerPluginId === pid)?.enabled
}, plugin.id)
assert.equal(on, true, 'owned skill re-enabled')
console.log('✓ enable plugin → owned re-enabled')

// 5) uninstall cascades the deletes.
await page.evaluate((id) => window.api.plugins.uninstall(id), plugin.id)
const after = await page.evaluate(async () => ({
  plugins: (await window.api.plugins.list()).length,
  skills: (await window.api.skills.list()).length,
  mcp: (await window.api.mcp.list()).length,
  reviewerRoles: (await window.api.roles.listCustom()).filter((r) => r.name === 'Reviewer').length
}))
console.log('after uninstall:', JSON.stringify(after))
assert.equal(after.plugins, 0, 'plugin removed')
assert.equal(after.skills, 0, 'owned skill removed')
assert.equal(after.mcp, 0, 'owned mcp removed')
assert.equal(after.reviewerRoles, 0, 'owned role removed')
console.log('✓ uninstall cascaded — skill + mcp + role all gone')

// 6) bad install rejects.
const badErr = await page.evaluate(
  (dir) => window.api.plugins.install(dir).then(() => null).catch((e) => String(e)),
  badDir
)
console.log('bad install →', badErr)
assert.ok(badErr && /plugin\.json/.test(badErr), 'install without plugin.json rejects clearly')
console.log('✓ bad install rejected')

rmSync(root, { recursive: true, force: true })
console.log(errors.length ? '✗ page errors: ' + JSON.stringify(errors) : '✓ no page errors')
await app.close()
process.exit(errors.length ? 1 : 0)
