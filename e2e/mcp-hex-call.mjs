// End-to-end: a real Engineer (Hex) agent run discovers + CALLS an MCP tool. Adds a stdio filesystem
// MCP server scoped to engineer, asks Hex to use its directory_tree tool (MCP-only — not in the core
// set, so a call proves the injection + tool_search path), and asserts the transcript shows an
// mcp__fs__* tool call. MANUAL — real opus LLM (costs money) + tool_search; LLM tool choice can vary, so
// rerun on a miss. Run: NS_KEY=<nsai-anthropic-key> node e2e/mcp-hex-call.mjs
import { _electron } from 'playwright'
import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/engineer-test'
const NS_KEY = process.env.NS_KEY || ''

mkdirSync(join(CWD, 'sub'), { recursive: true })
writeFileSync(join(CWD, 'readme.md'), '# test project\n')
writeFileSync(join(CWD, 'sub', 'a.txt'), 'hello\n')

const errors = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stderr?.on('data', (d) => process.stderr.write('[main:err] ' + d.toString()))
const page = await app.firstWindow()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const added = await page.evaluate(
  async ({ cwd, key }) => {
    localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ engineer: cwd }))
    localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'engineer' }))
    const bindings = await window.api.roles.listBindings()
    const eng = bindings.find((b) => b.roleId === 'engineer')
    const eps = await window.api.endpoints.list()
    const ep = eps.find((e) => e.id === eng?.endpointId)
    if (ep && !ep.hasKey && key) await window.api.endpoints.update(ep.id, { apiKey: key })
    const srv = await window.api.mcp.add({
      name: 'fs',
      transport: 'stdio',
      endpointOrCmd: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', cwd],
      scope: ['engineer'],
      enabled: true
    })
    return { id: srv.id, status: srv.status, toolCount: srv.toolCount }
  },
  { cwd: CWD, key: NS_KEY }
)
console.log('mcp server added:', JSON.stringify(added))
assert.equal(added.status, 'connected', 'filesystem MCP server connected')

await page.reload()
await page.waitForTimeout(1500)

const prompt =
  'Use the directory_tree tool to show the structure of /tmp/engineer-test, then summarize it in one short sentence.'
await page.fill('textarea.cmp-textarea', prompt)
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
console.log('sent prompt, waiting for the agent run...')

for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000)
  const allow = await page.$('.ap-allow')
  if (allow) {
    await allow.click() // auto-approve (throwaway cwd)
    continue
  }
  if (!(await page.$('.cmp-stop')) && i > 1) break
}
await page.waitForTimeout(2000)
await page.screenshot({ path: '/tmp/mcp-hex.png', fullPage: true })

const r = await page.evaluate(async () => {
  const convs = await window.api.conversations.list()
  const conv = convs.find((c) => c.primaryRoleId === 'engineer')
  const transcript = conv ? await window.api.agent.transcript(conv.id) : {}
  const calls = Object.values(transcript).flat()
  return { toolNames: calls.map((t) => t.name) }
})
console.log('tool calls:', JSON.stringify(r.toolNames))

await page.evaluate((id) => window.api.mcp.remove(id), added.id) // cleanup

const mcpCall = r.toolNames.find((n) => /^mcp__fs__/.test(n))
assert.ok(mcpCall, `Hex must call an mcp__fs__ tool (got ${JSON.stringify(r.toolNames)})`)
console.log(`✓ Hex discovered + called an MCP filesystem tool: ${mcpCall}`)

console.log(errors.length ? '✗ page errors: ' + JSON.stringify(errors) : '✓ no page errors')
await app.close()
process.exit(errors.length ? 1 : 0)
