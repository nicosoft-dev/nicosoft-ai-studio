// End-to-end designer image generation (B2+B3+B4). Boots the app, binds designer to a gemini chat model,
// sends an image request, and verifies the chat + ns_generate_image loop produced an image that:
//   - rides on the assistant message as an nsai-media:// attachment (NOT base64 in the DB), and
//   - exists as a file under ~/.nsai/media/<convId>/.
// MANUAL — calls real LLMs. NS_KEY optional (a configured studio.db runs with no env).
import { _electron } from 'playwright'
import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NS_KEY = process.env.NS_KEY || ''

const errors = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stdout?.on('data', (d) => process.stdout.write('[main:out] ' + d.toString()))
app.process().stderr?.on('data', (d) => process.stderr.write('[main:err] ' + d.toString()))
const page = await app.firstWindow()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text())
})
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

// Backfill keys + bind designer to a gemini chat model (the image backend defaults server-side).
const FORCED_MODEL = process.env.DESIGNER_MODEL || '' // node-side; passed into the browser context
await page.evaluate(
  async ({ key, forcedModel }) => {
    const eps = await window.api.endpoints.list()
    for (const ep of eps) if (!ep.hasKey && key) await window.api.endpoints.update(ep.id, { apiKey: key })
    const gemini = (await window.api.endpoints.list()).find((e) => e.protocol === 'gemini')
    if (!gemini) throw new Error('need a gemini-protocol endpoint')
    // gemini-2.5-flash is the stable function-calling model; gemini-3.5-flash returns empty 200s
    // intermittently via nsai (multi-channel routing). Override with the DESIGNER_MODEL env.
    const model = forcedModel || 'gemini-2.5-flash'
    await window.api.roles.setBinding('designer', { endpointId: gemini.id, model })
  },
  { key: NS_KEY, forcedModel: FORCED_MODEL }
)

await page.evaluate(() => localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'designer' })))
await page.reload()
await page.waitForTimeout(1500)

assert.ok(await page.$('textarea.cmp-textarea'), 'designer composer renders')
await page.fill('textarea.cmp-textarea', 'Draw a simple flat red apple on a plain white background.')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')
console.log('sent; waiting for the image-tool run...')

for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000)
  if (!(await page.$('.cmp-stop')) && i > 1) break
}
await page.waitForTimeout(2000)
await page.screenshot({ path: '/tmp/designer-image.png', fullPage: true })

const result = await page.evaluate(async () => {
  const convs = await window.api.conversations.list()
  const conv = convs.find((c) => c.primaryRoleId === 'designer')
  const msgs = conv ? await window.api.conversations.messages(conv.id) : []
  return {
    convId: conv?.id,
    onScreenError: document.querySelector('.inline-notice')?.textContent ?? null,
    msgs: msgs.map((m) => ({ author: m.author, expertId: m.expertId, attachments: m.attachments, preview: m.content.slice(0, 120) }))
  }
})
console.log('=== DB after run ===\n' + JSON.stringify(result, null, 2))

assert.equal(errors.length, 0, 'no JS errors:\n' + errors.join('\n'))
assert.ok(result.convId, 'a designer conversation was created')
const assistant = result.msgs.find((m) => m.author !== 'user')
assert.ok(assistant, 'an assistant reply persisted')

// The image is an nsai-media:// attachment — never base64 in the DB.
const atts = assistant.attachments ?? []
const imgAtt = atts.find((a) => typeof a.url === 'string' && a.url.startsWith('nsai-media://'))
assert.ok(imgAtt, 'assistant message carries an nsai-media:// image attachment')
assert.ok(!atts.some((a) => typeof a.url === 'string' && a.url.startsWith('data:')), 'NO base64 attachment in the DB')

// The file is on disk under ~/.nsai/media/<convId>/.
const mediaDir = join(homedir(), '.nsai', 'media', result.convId)
assert.ok(existsSync(mediaDir), 'media dir exists for the conversation: ' + mediaDir)
const files = readdirSync(mediaDir)
assert.ok(files.length >= 1, 'at least one image file on disk')
console.log('media files:', files.join(', '))

await app.close()
console.log(`✓ designer image-gen e2e OK (attachment: ${imgAtt.url})`)
