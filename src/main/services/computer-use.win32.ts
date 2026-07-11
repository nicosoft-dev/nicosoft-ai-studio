// Windows platform primitives for computer use — the counterpart to computer-use.darwin.ts. The
// helper (NsComputerUseHelper.exe, pure C++/MSVC, statically linked /MT so it needs no VC++
// redistributable) owns the OS work (WGC screenshots, SendInput, UI Automation) behind the same
// newline JSON-RPC contract as the macOS helper — over a named pipe instead of a unix socket. This
// module supplies only the platform primitives; transport, lifecycle, and refcount stay in the
// neutral computer-use.ts.
//
// Windows has no TCC: screen capture and input synthesis need no per-app grant, so there's no
// permission dance, no `open -g` LaunchServices attribution, and no signature-preserving copy.

import { execFile, execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ComputerUsePlatform } from './computer-use.platform'

const execFileAsync = promisify(execFile)

// Mirror of the macOS install dir. electron-builder stages the .exe under <resources>/computer-use
// (win only); Studio copies it here on enable so it runs from a stable, Studio-independent path.
const HELPER_INSTALL_DIR = join(homedir(), '.nsai', 'computer-use')
const HELPER_EXE_NAME = 'NsComputerUseHelper.exe'
const BUNDLED_SUBDIR = 'computer-use'
// Sidecar version file staged next to the bundled .exe (the exe's own FileVersion would need a native
// read; a text file mirrors the macOS Info.plist compare cheaply). Absent → treated as unknown.
const VERSION_FILE = 'VERSION'

function bundledDir(): string {
  return join(process.resourcesPath, BUNDLED_SUBDIR)
}

function transportPath(): string {
  // Must byte-match the pipe name the helper binds (\\.\pipe\nicosoft_nscu). node `net` connects to a
  // Windows named pipe through the same createConnection(path) it uses for a unix socket.
  return process.env.NSAI_CUA_PIPE || '\\\\.\\pipe\\nicosoft_nscu'
}

function installedHelperPath(): string | null {
  const p = join(HELPER_INSTALL_DIR, HELPER_EXE_NAME)
  return existsSync(p) ? p : null
}

// The .exe bundled inside Studio (win.extraResources → <resources>/computer-use). Absent in dev / e2e
// → null, and we fall back to whatever is already installed under ~/.nsai/computer-use.
function bundledExePath(): string | null {
  const p = join(bundledDir(), HELPER_EXE_NAME)
  return existsSync(p) ? p : null
}

function readVersion(dir: string): string | null {
  try {
    return readFileSync(join(dir, VERSION_FILE), 'utf8').trim()
  } catch {
    return null
  }
}

// Copy when the bundled .exe is MISSING from the install dir or is a different version. Windows has no
// TCC grant to preserve, but we still avoid a needless re-copy of an identical version. No-op in dev
// (nothing bundled) — the dev copy is used as-is.
function needsInstall(): boolean {
  const bundled = bundledExePath()
  if (!bundled) return false
  const dest = join(HELPER_INSTALL_DIR, HELPER_EXE_NAME)
  if (existsSync(dest) && readVersion(HELPER_INSTALL_DIR) === readVersion(bundledDir())) return false
  return true
}

// A single statically-linked .exe (plus its VERSION sidecar) — a plain file copy, no ditto/signature
// concerns. The exe depends only on system DLLs, so nothing else needs staging.
async function install(): Promise<void> {
  const bundled = bundledExePath()
  if (!bundled) return
  mkdirSync(HELPER_INSTALL_DIR, { recursive: true })
  copyFileSync(bundled, join(HELPER_INSTALL_DIR, HELPER_EXE_NAME))
  const version = join(bundledDir(), VERSION_FILE)
  if (existsSync(version)) copyFileSync(version, join(HELPER_INSTALL_DIR, VERSION_FILE))
}

// Spawn detached so the helper outlives this call and inherits Studio's interactive desktop session
// (WGC capture and the layered overlay need a DWM-backed desktop — Studio, a GUI app, is already in
// one). unref() lets Studio exit without waiting on it; the 'error' handler keeps a failed spawn
// (e.g. missing exe) from surfacing as an unhandled event — the connect poll then reports it.
async function launch(exePath: string): Promise<void> {
  const child = spawn(exePath, [], { detached: true, stdio: 'ignore' })
  child.on('error', () => undefined)
  child.unref()
}

async function quit(): Promise<void> {
  try {
    await execFileAsync('taskkill', ['/f', '/im', HELPER_EXE_NAME])
  } catch {
    // taskkill exits non-zero when no matching process — already not running.
  }
}

// before-quit path: the helper was spawned detached+unref, so it deliberately outlives Studio — and an
// async taskkill fired mid-quit may never spawn before the process dies. Synchronous with a hard
// timeout so a quit can never hang on it.
function quitSync(): void {
  try {
    execFileSync('taskkill', ['/f', '/im', HELPER_EXE_NAME], { timeout: 3_000 })
  } catch {
    // taskkill exits non-zero when no matching process — already not running.
  }
}

export const win32Platform: ComputerUsePlatform = {
  supported: true,
  helperLabel: HELPER_EXE_NAME,
  overlayLabel: 'NicoSoft AI Studio is controlling this PC',
  transportPath,
  installedHelperPath,
  needsInstall,
  install,
  launch,
  quit,
  quitSync,
}
