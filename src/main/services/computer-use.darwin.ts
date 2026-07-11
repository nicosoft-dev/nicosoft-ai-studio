// macOS platform primitives for computer use — a function-for-function move out of the original
// services/computer-use.ts, behavior unchanged. The helper (NsComputerUseHelper, bundle
// dev.nicosoft.cuh, installed as "NicoSoft Computer Use.app") owns the TCC-sensitive work
// (ScreenCaptureKit screenshots, CGEvent input, AX tree). This module supplies only the platform
// primitives (transport path, install/launch/quit); the JSON-RPC transport, lifecycle orchestration,
// and overlay refcount live in the neutral computer-use.ts.

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ComputerUsePlatform } from './computer-use.platform'

const execFileAsync = promisify(execFile)

// electron-builder bundles the .app into <resources>/computer-use (mac only); Studio copies it here on
// enable so it holds TCC grants on a stable, Studio-independent path.
const HELPER_INSTALL_DIR = join(homedir(), '.nsai', 'computer-use')
const HELPER_APP_NAME = 'NicoSoft Computer Use.app'
// Full-argv pkill pattern (regex; dots match themselves loosely — distinctive enough that false
// positives are implausible). The bare exec name can't be used: macOS p_comm truncates at 16 chars.
const HELPER_PKILL_PATTERN = 'NicoSoft Computer Use\\.app/Contents/MacOS/NsComputerUseHelper'

function transportPath(): string {
  return process.env.NSAI_CUA_SOCKET || join(homedir(), '.nsai', 'computer-use', 'sock', 'nscu.sock')
}

// The helper installs under ~/.nsai/computer-use (the copy Studio makes on enable). ~/Applications is
// kept as a legacy fallback for an earlier manual install; /Applications covers a system-wide copy.
function installedHelperPath(): string | null {
  for (const dir of [HELPER_INSTALL_DIR, join(homedir(), 'Applications'), '/Applications']) {
    const p = join(dir, HELPER_APP_NAME)
    if (existsSync(p)) return p
  }
  return null
}

// The helper .app bundled inside Studio by electron-builder (mac.extraResources → <resources>/computer-use).
// Absent in dev / e2e (process.resourcesPath points at Electron's own Resources) → returns null, and we
// fall back to whatever is already installed under ~/.nsai/computer-use (the manually-installed dev copy).
function bundledAppPath(): string | null {
  const p = join(process.resourcesPath, 'computer-use', HELPER_APP_NAME)
  return existsSync(p) ? p : null
}

// CFBundleShortVersionString from an .app's Info.plist (or null). A light regex read avoids a plutil spawn.
function appShortVersion(appPath: string): string | null {
  try {
    const xml = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8')
    const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(xml)
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}

// Copy when the bundled helper is MISSING from the install dir, or is a different version — so helper
// fixes ride Studio updates. NOT for an identical version, so a user's granted TCC permissions survive
// Studio updates that keep the helper version fixed (the CI cert is ephemeral, so re-copying an
// identical version would needlessly reset the grant). No-op in dev (nothing bundled) — the dev copy
// is used as-is.
function needsInstall(): boolean {
  const bundled = bundledAppPath()
  if (!bundled) return false
  const dest = join(HELPER_INSTALL_DIR, HELPER_APP_NAME)
  if (existsSync(dest) && appShortVersion(dest) === appShortVersion(bundled)) return false
  return true
}

// `ditto` preserves the code signature / symlinks / xattrs a naive recursive copy corrupts.
async function install(): Promise<void> {
  const bundled = bundledAppPath()
  if (!bundled) return
  const dest = join(HELPER_INSTALL_DIR, HELPER_APP_NAME)
  mkdirSync(HELPER_INSTALL_DIR, { recursive: true })
  rmSync(dest, { recursive: true, force: true })
  await execFileAsync('ditto', [bundled, dest])
}

// `open -g` keeps it in the background; going through LaunchServices (not spawning the inner binary)
// is REQUIRED — a direct child process could be TCC-attributed to Studio instead of the helper bundle.
async function launch(appPath: string): Promise<void> {
  await execFileAsync('open', ['-g', appPath])
}

async function quit(): Promise<void> {
  try {
    await execFileAsync('pkill', ['-f', HELPER_PKILL_PATTERN])
  } catch {
    // pkill exits 1 when nothing matched — already not running.
  }
}

// before-quit path: the helper was launched via LaunchServices (`open -g`), so it is NOT Studio's child
// and survives Studio's exit — and an async pkill fired mid-quit may never spawn before the process
// dies. Synchronous with a hard timeout so a quit can never hang on it.
function quitSync(): void {
  try {
    execFileSync('pkill', ['-f', HELPER_PKILL_PATTERN], { timeout: 3_000 })
  } catch {
    // pkill exits 1 when nothing matched — already not running.
  }
}

export const darwinPlatform: ComputerUsePlatform = {
  supported: true,
  helperLabel: HELPER_APP_NAME,
  overlayLabel: 'NicoSoft AI Studio is controlling this Mac',
  transportPath,
  installedHelperPath,
  needsInstall,
  install,
  launch,
  quit,
  quitSync,
}
