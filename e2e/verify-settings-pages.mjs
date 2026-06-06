// Verify the Settings General / Privacy / About pages are real (replacing the dashed "X settings"
// placeholder). About shows the real app version (app:info), Privacy shows the real local data folder +
// on-device counts (with a clickable reveal), General shows appearance/language. Screenshots all three.
//   node e2e/verify-settings-pages.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = '/tmp/e2e-settings-shots'
rmSync(SHOTS, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

await page.evaluate(() => localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'settings', settingsTab: 'about' })))
await page.reload()
await page.waitForTimeout(1200)

const info = await page.evaluate(() => window.api.app.info())
await page.screenshot({ path: join(SHOTS, 'about.png') })
const aboutDom = await page.evaluate(() => ({
  ver: document.querySelector('.about-ver')?.textContent ?? '',
  placeholder: !!document.querySelector('[style*="dashed"]')
}))

await page.locator('.sn-item', { hasText: 'Privacy' }).first().click()
await page.waitForTimeout(500)
await page.screenshot({ path: join(SHOTS, 'privacy.png') })
const privacyDom = await page.evaluate(() => ({
  dataFolder: document.querySelector('.set-row-val.mono')?.textContent ?? '',
  counts: [...document.querySelectorAll('.set-row-val')].map((e) => e.textContent).find((t) => /conversations/.test(t ?? '')) ?? '',
  points: document.querySelectorAll('.set-points li').length
}))

await page.locator('.sn-item', { hasText: 'General' }).first().click()
await page.waitForTimeout(500)
await page.screenshot({ path: join(SHOTS, 'general.png') })
const generalDom = await page.evaluate(() => [...document.querySelectorAll('.set-row-val')].map((e) => e.textContent))

await app.close()

console.log('app:info:', JSON.stringify(info))
console.log('about:', JSON.stringify(aboutDom))
console.log('privacy:', JSON.stringify(privacyDom))
console.log('general rows:', JSON.stringify(generalDom))
console.log('screenshots in', SHOTS)

const fails = []
if (!info.version || !info.dataDir) fails.push('app:info missing version/dataDir')
if (aboutDom.placeholder) fails.push('a dashed placeholder is still present — page not wired')
if (!aboutDom.ver.includes(info.version)) fails.push(`About did not show the real version (${info.version})`)
if (!privacyDom.dataFolder.includes('.nsai')) fails.push('Privacy did not show the real data folder path')
if (!/conversations/.test(privacyDom.counts)) fails.push('Privacy did not show the on-device counts')
if (privacyDom.points < 3) fails.push('Privacy points missing')
if (!generalDom.includes('Dark')) fails.push('General did not render appearance/language rows')
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : `\n✓ PASS — Settings General/Privacy/About are real: version v${info.version}, data folder ${info.dataDir}, ${info.conversations} conversations · ${info.memories} memories; no placeholders`
)
process.exit(fails.length ? 1 : 0)
