// Diagnose the "black roles page": is ExpertDetail (view='expert') / the Settings Roles tab not built,
// or failing to load? Navigate to each, screenshot, dump the rendered DOM + ALL console errors and
// uncaught exceptions. A runtime error → "not loading"; an empty-but-clean render → "not built".
//   node e2e/diagnose-roles-page.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'

const SHOTS = '/tmp/e2e-roles-diag'
rmSync(SHOTS, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const snapshot = async (label) => {
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(SHOTS, label + '.png') })
  return page.evaluate(() => {
    const main = document.querySelector('.main-col, .settings-content, .detail-col, [class*="detail"]')
    const root = document.body
    return {
      textLen: (root.innerText || '').trim().length,
      visibleText: (root.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      hasDetailCard: !!document.querySelector('.detail-card'),
      mainColPresent: !!document.querySelector('.main-col'),
      bg: main ? getComputedStyle(main).backgroundColor : 'n/a'
    }
  })
}

// (1) Expert detail page (view='expert')
await page.evaluate(() => localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'expert', activeExpert: 'engineer' })))
await page.reload()
const expertDetail = await snapshot('1-expert-detail')
const errAfterExpert = [...errors]

// (2) Settings → Roles tab
errors.length = 0
await page.evaluate(() => localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'settings', settingsTab: 'roles' })))
await page.reload()
const rolesTab = await snapshot('2-settings-roles')
const errAfterRoles = [...errors]

await app.close()

console.log('=== (1) Expert detail (view=expert) ===')
console.log(JSON.stringify(expertDetail, null, 0))
console.log('errors:', errAfterExpert.length ? '\n  ' + errAfterExpert.join('\n  ') : 'none')
console.log('\n=== (2) Settings → Roles tab ===')
console.log(JSON.stringify(rolesTab, null, 0))
console.log('errors:', errAfterRoles.length ? '\n  ' + errAfterRoles.join('\n  ') : 'none')
console.log('\nscreenshots in', SHOTS)

const verdict = (name, snap, errs) => {
  if (errs.length) return `${name}: NOT LOADING — ${errs.length} runtime error(s); first: ${errs[0]}`
  if (snap.textLen < 15) return `${name}: BLANK — renders almost no text (textLen=${snap.textLen}); likely not built / empty branch`
  return `${name}: RENDERS — textLen=${snap.textLen}, detailCard=${snap.hasDetailCard}`
}
console.log('\n' + verdict('Expert detail', expertDetail, errAfterExpert))
console.log(verdict('Settings Roles tab', rolesTab, errAfterRoles))
