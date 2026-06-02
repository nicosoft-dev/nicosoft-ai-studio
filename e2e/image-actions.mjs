// Verifies Batch 5 image actions: a generated image opens in the viewer, the Download + Refine buttons
// are present, and Refine closes the viewer + seeds the composer (designer keeps the prior image in
// context, so the user types the change and sends → regenerate). The Download save-dialog is native
// (electron) and can't be driven headlessly, so we assert the button exists but don't click it.
// Binds designer to the studio DEFAULT (gemini-pro-latest + nano-banana-pro-preview + high) → no
// pollution. gemini-3 function-calling is occasionally flaky — rerun on a no-image failure, or pass
// DESIGNER_MODEL=gemini-2.5-flash for a stable run. MANUAL — real LLM + image backend.
import { _electron } from 'playwright'
import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NS_KEY = process.env.NS_KEY || ''
const CHAT_MODEL = process.env.DESIGNER_MODEL || 'gemini-pro-latest'

const errors = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stderr?.on('data', (d) => process.stderr.write('[main:err] ' + d.toString()))
const page = await app.firstWindow()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

await page.evaluate(
  async ({ key, model }) => {
    const eps = await window.api.endpoints.list()
    for (const ep of eps) if (!ep.hasKey && key) await window.api.endpoints.update(ep.id, { apiKey: key })
    const gemini = (await window.api.endpoints.list()).find((e) => e.protocol === 'gemini')
    if (!gemini) throw new Error('need a gemini-protocol endpoint')
    await window.api.roles.setBinding('designer', { endpointId: gemini.id, model, imageModel: 'nano-banana-pro-preview', thinkingDepth: 'high' })
  },
  { key: NS_KEY, model: CHAT_MODEL }
)
await page.evaluate(() => localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'designer' })))
await page.reload()
await page.waitForTimeout(1500)

await page.fill('textarea.cmp-textarea', 'Draw a simple flat red apple on a plain white background.')
await page.keyboard.press('Enter')

// Wait for a finished (non-loading) image thumbnail.
let imgOk = false
for (let i = 0; i < 220; i++) {
  await page.waitForTimeout(200)
  if (await page.$('.msg-img-thumb:not(.msg-img-loading)')) {
    imgOk = true
    break
  }
}
assert.ok(imgOk, 'designer generated an image (gemini-3 flaky — rerun if this fails with no image)')
console.log('✓ image generated')

// Open the lightbox.
await page.click('.msg-img-thumb:not(.msg-img-loading)')
await page.waitForSelector('.img-viewer', { timeout: 5000 })
console.log('✓ viewer opened')

const actions = await page.$$eval('.iv-action', (els) => els.map((e) => (e.textContent || '').trim()))
console.log('viewer actions:', JSON.stringify(actions))
assert.ok(actions.some((t) => /Refine/i.test(t)), `Refine button present (got ${JSON.stringify(actions)})`)
assert.ok(actions.some((t) => /Download/i.test(t)), `Download button present (got ${JSON.stringify(actions)})`)
console.log('✓ Refine + Download buttons present in viewer')

// Refine closes the viewer and seeds the composer.
await page.click('.iv-action:has-text("Refine")')
await page.waitForTimeout(400)
const viewerGone = !(await page.$('.img-viewer'))
const composerVal = await page.inputValue('textarea.cmp-textarea')
console.log('after Refine — viewerGone:', viewerGone, 'composer:', JSON.stringify(composerVal))
assert.ok(viewerGone, 'Refine closed the viewer')
assert.ok(/Refine the image above/i.test(composerVal), `Refine seeded the composer (got ${JSON.stringify(composerVal)})`)
console.log('✓ Refine closed viewer + seeded composer with the refine lead-in')

await page.screenshot({ path: '/tmp/image-actions.png', fullPage: true })
console.log(errors.length ? '✗ page errors: ' + JSON.stringify(errors) : '✓ no page errors')
await app.close()
process.exit(errors.length ? 1 : 0)
