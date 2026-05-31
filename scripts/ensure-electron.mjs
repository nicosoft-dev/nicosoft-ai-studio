// Workaround for a broken Electron install under Node 24.
//
// electron 42's bundled install.js extracts the binary with extract-zip, which HANGS under
// Node 24 (its promise never settles). install.js fires it as an un-awaited top-level promise,
// so the process exits mid-extract: the Electron Framework is left partially unpacked and
// path.txt is never written, and `require('electron')` then resolves to a binary dyld can't load
// ("Library not loaded: Electron Framework").
//
// This re-downloads (cache-hit is instant) and extracts via the OS unzip tool instead of
// extract-zip — ditto on macOS (preserves the .app's symlinks/permissions), Expand-Archive on
// Windows, unzip on Linux. Idempotent: exits immediately if the install is already complete.
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const electronDir = join(process.cwd(), 'node_modules', 'electron')
if (!existsSync(electronDir)) process.exit(0) // electron not installed (e.g. --omit=dev)

const { version } = require(join(electronDir, 'package.json'))
const plat = process.platform
const platformPath =
  plat === 'darwin'
    ? 'Electron.app/Contents/MacOS/Electron'
    : plat === 'win32'
      ? 'electron.exe'
      : 'electron'

const distDir = join(electronDir, 'dist')
const pathTxt = join(electronDir, 'path.txt')
const frameworkOK =
  plat !== 'darwin' ||
  existsSync(join(distDir, 'Electron.app', 'Contents', 'Frameworks', 'Electron Framework.framework'))

if (existsSync(join(distDir, platformPath)) && existsSync(pathTxt) && frameworkOK) {
  process.exit(0) // already complete
}

console.log(`[ensure-electron] electron ${version}: extraction incomplete, reinstalling...`)
const { downloadArtifact } = await import('@electron/get')
const zipPath = await downloadArtifact({
  version,
  artifactName: 'electron',
  checksums: require(join(electronDir, 'checksums.json'))
})

rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })

// extract-zip hangs under Node 24, so shell out to the OS unzip tool.
if (plat === 'darwin') {
  execFileSync('ditto', ['-x', '-k', zipPath, distDir], { stdio: 'inherit' })
} else if (plat === 'win32') {
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${distDir}' -Force`],
    { stdio: 'inherit' }
  )
} else {
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', distDir], { stdio: 'inherit' })
}

writeFileSync(pathTxt, platformPath)
console.log(`[ensure-electron] electron ${version} ready`)
