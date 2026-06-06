// Verify the dev app icon wiring: in the running main process the icon path resolves to a real,
// non-empty 1024 nativeImage (same logic index.ts uses for the dock + window icon), and capture the
// macOS dock to visually confirm the N replaced the default Electron icon.
//   node e2e/verify-icon.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await new Promise((r) => setTimeout(r, 1800))

// Resolve + load the icon exactly as index.ts does (appPath + build/icon.png). A non-empty nativeImage
// proves the path resolved to a real, valid image — no fs needed (require isn't available here).
const info = await app.evaluate(({ app, nativeImage }, rel) => {
  const p = app.getAppPath() + '/' + rel
  const img = nativeImage.createFromPath(p)
  const empty = img.isEmpty()
  return {
    platform: process.platform,
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    iconPath: p,
    empty,
    size: empty ? null : img.getSize(),
    hasDock: !!app.dock
  }
}, '../../build/icon.png')
console.log('icon runtime:', JSON.stringify(info))

let shot = null
try {
  execSync('screencapture -x /tmp/nsai-dock.png', { timeout: 8000 })
  shot = '/tmp/nsai-dock.png'
} catch (e) {
  console.log('screencapture unavailable:', e.message)
}

await app.close()

const fails = []
if (info.empty) fails.push('nativeImage loaded empty (path did not resolve): ' + info.iconPath)
if (!info.size || info.size.width !== 1024) fails.push('icon not 1024: ' + JSON.stringify(info.size))
console.log(
  fails.length
    ? '✗ FAIL: ' + fails.join('; ')
    : `✓ PASS — dev icon resolves at runtime: ${info.iconPath} (${info.size.width}x${info.size.height}); dock API available=${info.hasDock}, packaged=${info.isPackaged}`
)
if (shot) console.log('dock screenshot:', shot)
process.exit(fails.length ? 1 : 0)
