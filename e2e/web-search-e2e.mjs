// web-search-e2e: OpenAI server-side web_search (doc 16 §4). The generalist (OpenAI Responses) is asked
// to look something up. We confirm a web_search_call server block was emitted (the API ran the search,
// carried as a server block in the transcript) and that an answer came back. MANUAL — needs a real key
// AND an endpoint that supports Responses web_search. Run: node e2e/web-search-e2e.mjs
import { _electron } from 'playwright'
import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stderr?.on('data', (d) => process.stderr.write('[main:err] ' + d.toString()))
const page = await app.firstWindow()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async () => {
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'generalist' }))
  const bindings = await window.api.roles.listBindings()
  const gen = bindings.find((b) => b.roleId === 'generalist')
  const eps = await window.api.endpoints.list()
  const ep = eps.find((e) => e.id === gen?.endpointId)
  return { hasKey: !!ep?.hasKey, baseUrl: ep?.baseUrl, protocol: ep?.protocol, model: gen?.model }
})
console.log('generalist endpoint:', JSON.stringify(setup))
if (!setup.hasKey) {
  console.log('⚠ SKIP — generalist endpoint has no API key.')
  await app.close()
  process.exit(0)
}

await page.reload()
await page.waitForTimeout(1500)

await page.fill(
  'textarea.cmp-textarea',
  'Search the web for the 3 most recent major Node.js releases and their dates, then summarize them. Cite your sources.'
)
await page.keyboard.press('Enter')
console.log('sent web-search prompt, waiting...')

for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
  if (!(await page.$('.cmp-stop')) && i > 1) break
}
await page.waitForTimeout(1500)
await page.screenshot({ path: '/tmp/web-search.png', fullPage: true })

const info = await page.evaluate(async () => {
  const convs = await window.api.conversations.list()
  const conv = convs.find((c) => c.primaryRoleId === 'generalist')
  const msgs = conv ? await window.api.conversations.messages(conv.id) : []
  const last = [...msgs].reverse().find((m) => m.author !== 'user')
  return { convId: conv?.id, answer: last?.content ?? '' }
})

const tPath = info.convId ? join(homedir(), '.nsai', 'sessions', info.convId, 'transcript.jsonl') : ''
const transcript = tPath && existsSync(tPath) ? readFileSync(tPath, 'utf8') : ''
const sawWebSearch = transcript.includes('web_search_call')
const sawError = /\"error\"|error_/.test(transcript)

console.log('--- answer (head) ---')
console.log(info.answer.slice(0, 280))
const ui = await page.evaluate(() => {
  const bubbles = [...document.querySelectorAll('.server-bubble')].map((e) => e.textContent?.replace(/\s+/g, ' ').trim())
  const visited = [...document.querySelectorAll('.server-bubble.sb-link')].map((e) => e.getAttribute('href'))
  const sources = [...document.querySelectorAll('.msg-sources .ms-item')].map((e) => ({
    title: e.querySelector('.ms-title')?.textContent,
    href: e.getAttribute('href')
  }))
  return { bubbles, visited, sources }
})

console.log('--- signals ---')
console.log('web_search_call in transcript:', sawWebSearch)
console.log('server bubbles (UI):', JSON.stringify(ui.bubbles))
console.log('visited sites (open_page):', JSON.stringify(ui.visited))
console.log('Sources list:', JSON.stringify(ui.sources, null, 2))
console.log('transcript has error:', sawError, '| page errors:', errors.length ? JSON.stringify(errors) : 'none')

assert.ok(info.answer.trim().length > 0, 'generalist must produce an answer')
assert.ok(sawWebSearch, 'web_search_call must be in the transcript (the API ran the search)')
console.log('✓ web_search ran')
assert.ok(ui.bubbles.length > 0, 'must show web-search status row(s)')
console.log(`✓ ${ui.bubbles.length} search status row(s), ${ui.visited.length} visited site(s)`)
assert.ok(ui.sources.length > 0, 'must show a Sources list (citations)')
assert.ok(ui.sources.every((s) => s.href && s.href.startsWith('http')), 'each source must link to its URL')
console.log(`✓ Sources list: ${ui.sources.length} clickable citation(s)`)
await app.close()
process.exit(0)
