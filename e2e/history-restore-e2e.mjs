// history-restore-e2e: reopening a past web_search conversation rebuilds the search status rows +
// Sources list from the transcript (not just the answer text). A fresh app launch has an empty
// in-memory store, so opening the conversation must reconstruct everything via readTranscript.
// Depends on a prior web-search run having left a generalist conversation. Run: node e2e/history-restore-e2e.mjs
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
await page.waitForTimeout(1500)

// Find a past conversation whose transcript carries web_search server blocks + citations.
const target = await page.evaluate(async () => {
  const convs = await window.api.conversations.list()
  for (const c of convs) {
    const t = await window.api.agent.transcript(c.id)
    const runs = Object.values(t)
    const servers = runs.reduce((n, r) => n + r.servers.length, 0)
    const citations = runs.reduce((n, r) => n + r.citations.length, 0)
    if (servers > 0 && citations > 0) return { id: c.id, title: c.title ?? '', servers, citations }
  }
  return null
})
if (!target) {
  console.log('⚠ SKIP — no past conversation with web_search in its transcript (run web-search-e2e first).')
  await app.close()
  process.exit(0)
}
console.log('target conversation (transcript has):', JSON.stringify(target))

// Open it from the history sidebar — a fresh load that must rebuild from the transcript.
await page.locator('.hist-row').filter({ hasText: target.title.slice(0, 18) }).first().click()
await page.waitForTimeout(1500)
await page.screenshot({ path: '/tmp/history-restore.png', fullPage: true })

const ui = await page.evaluate(() => ({
  bubbles: document.querySelectorAll('.server-bubble').length,
  visited: document.querySelectorAll('.server-bubble.sb-link').length,
  sources: document.querySelectorAll('.msg-sources .ms-item').length
}))
console.log('rebuilt from transcript:', JSON.stringify(ui))
console.log('page errors:', errors.length ? JSON.stringify(errors) : 'none')

assert.ok(ui.bubbles > 0, `server bubbles must rebuild from transcript (got ${ui.bubbles})`)
assert.ok(ui.sources > 0, `Sources must rebuild from transcript (got ${ui.sources})`)
console.log(`✓ reopened from transcript: ${ui.bubbles} search row(s), ${ui.visited} visited, ${ui.sources} source(s)`)
assert.equal(errors.length, 0, 'no page errors')
await app.close()
process.exit(0)
