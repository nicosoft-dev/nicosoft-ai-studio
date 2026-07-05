// Platform abstraction for the computer-use helper. It pulls the OS-specific primitives (transport
// endpoint, install/launch/quit, banner text) out of the neutral orchestration in computer-use.ts
// (the HelperClient JSON-RPC transport, helper lifecycle, and overlay refcount). The orchestration
// layer depends only on this interface; darwin/win32 each implement it, and the selector picks one
// once by process.platform — so the orchestration has zero if-platform branching.
//
// Isolation principle: share what can be shared (JSON-RPC transport, status orchestration, the
// data-driven Screen-Recording restart), isolate what can't into darwin.ts / win32.ts (unix socket
// vs named pipe, `open -g` vs spawn, pkill vs taskkill, ditto vs copy, TCC vs always-granted). The
// macOS implementation is a function-for-function move of the original computer-use.ts — behavior
// unchanged.

export interface ComputerUsePlatform {
  // Whether computer use is supported here (darwin/win32 = true; anything else = false).
  readonly supported: boolean
  // The on-disk helper's name — used only in error messages (.app / .exe).
  readonly helperLabel: string
  // Banner text passed to the helper via set_active. The macOS helper renders it; the Windows helper
  // currently draws its own hardcoded text (ignores this param) but the semantics stay correct, so a
  // future helper that reads the label lines up automatically.
  readonly overlayLabel: string
  // The endpoint the helper listens on: macOS = unix socket path, Windows = named-pipe name. node
  // `net`'s createConnection takes either through the same API — only this string differs.
  transportPath(): string
  // Full path of the installed helper on disk (the card's appPath + what launch() runs), or null.
  installedHelperPath(): string | null
  // Whether the Studio-bundled helper should be copied into the install dir: bundled exists AND
  // (not installed OR a different version). Version comparison is platform detail (macOS reads
  // Info.plist, Windows reads a VERSION file), encapsulated here.
  needsInstall(): boolean
  // Copy the Studio-bundled helper into the install dir (creates the dir / clears the old copy).
  // Only called when needsInstall() is true.
  install(): Promise<void>
  // Launch the helper process. macOS goes through `open -g` (via LaunchServices so TCC attributes to
  // the helper bundle); Windows spawns detached (inheriting Studio's interactive desktop session,
  // which WGC capture and the overlay require — they need a DWM-backed desktop).
  launch(path: string): Promise<void>
  // Stop the helper process (macOS pkill -f; Windows taskkill /f /im).
  quit(): Promise<void>
}

// Deferred imports of the two implementations. Both modules are bundled on every platform, but their
// top level only defines functions/constants — no OS-specific call runs until the selected platform's
// method is invoked — so loading win32 on a Mac (and vice versa) has no side effects.
import { darwinPlatform } from './computer-use.darwin'
import { win32Platform } from './computer-use.win32'

// Fallback for unsupported platforms (Linux, etc.): supported=false short-circuits every caller, so
// the throwing/no-op stubs are never actually reached — they exist only to satisfy the interface.
const unsupportedPlatform: ComputerUsePlatform = {
  supported: false,
  helperLabel: 'NsComputerUseHelper',
  overlayLabel: 'NicoSoft AI Studio is controlling this computer',
  transportPath: () => {
    throw new Error('computer use is not supported on this platform')
  },
  installedHelperPath: () => null,
  needsInstall: () => false,
  install: async () => {
    /* no-op */
  },
  launch: async () => {
    throw new Error('computer use is not supported on this platform')
  },
  quit: async () => {
    /* no-op */
  },
}

export const platform: ComputerUsePlatform =
  process.platform === 'darwin' ? darwinPlatform : process.platform === 'win32' ? win32Platform : unsupportedPlatform
