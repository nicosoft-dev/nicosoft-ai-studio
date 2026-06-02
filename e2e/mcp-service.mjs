// Stage-B verify: drive the MCP service through real IPC (window.api.mcp) — add a real stdio filesystem
// server scoped to engineer, test it (connect + discover), confirm it lists with connected status +
// persisted scope/transport, then remove it. Proves repo + keychain + manager + IPC wiring end to end.
// No LLM. Run: node e2e/mcp-service.mjs
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
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const r = await page.evaluate(async () => {
  const added = await window.api.mcp.add({
    name: 'fs-test',
    transport: 'stdio',
    endpointOrCmd: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    scope: ['engineer'],
    enabled: true
  })
  const test = await window.api.mcp.test(added.id)
  const list = await window.api.mcp.list()
  const found = list.find((s) => s.id === added.id)
  await window.api.mcp.remove(added.id)
  const afterRemove = await window.api.mcp.list()
  return {
    addedId: added.id,
    addedStatus: added.status,
    testOk: test.ok,
    testToolCount: test.toolCount,
    testError: test.error,
    foundStatus: found?.status,
    foundScope: found?.scope,
    foundTransport: found?.transport,
    removedGone: !afterRemove.some((s) => s.id === added.id)
  }
})
console.log('result:', JSON.stringify(r))
assert.ok(r.addedId, 'mcp.add returns a server with id')
assert.ok(r.testOk, `mcp.test succeeds (error=${r.testError})`)
assert.ok(r.testToolCount > 0, `test discovers tools (got ${r.testToolCount})`)
assert.equal(r.foundStatus, 'connected', 'list shows connected status after test')
assert.deepEqual(r.foundScope, ['engineer'], 'scope persisted')
assert.equal(r.foundTransport, 'stdio', 'transport persisted')
assert.ok(r.removedGone, 'remove deletes the server')
console.log('✓ MCP service IPC (add/test/list/remove) works against a real filesystem server')

console.log(errors.length ? '✗ page errors: ' + JSON.stringify(errors) : '✓ no page errors')
await app.close()
process.exit(errors.length ? 1 : 0)
