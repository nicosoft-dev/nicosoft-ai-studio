// IPC boundary for the install confirmation dialog (extension-install-design §5.4). Three read/side
// channels the renderer's InstallApproval UI needs while a permission prompt is up:
//   extensions:previewInstall — parse the proposed source MAIN-SIDE and return the concrete
//     consequences to display (skill fields / plugin component list / mcp command + network warning).
//     Policy (what earns the red network warning) lives here, not in the renderer.
//   extensions:pickDir — neutral folder picker (the user swaps/chooses the install source by hand).
//   extensions:stashSecrets — one-shot stash for MCP secret VALUES: dialog → main directly; the
//     permission answer carries only the returned token (install-secrets.ts), never the values.

import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { pickDirectory } from './dialogs'
import { loadSkillDir } from '../skills/loader'
import { parsePlugin } from '../plugins/manifest'
import { stashInstallSecrets } from '../services/extensions/install-secrets'
import type { InstallPreview } from './contracts'

// Commands that FETCH FROM THE NETWORK at connect time (npx & friends download the package before
// running it). These installs get the red "fetches from the network and runs it" line in the dialog —
// user decision: warning text only, no extra checkbox/confirm (design §0.2-8).
const NET_FETCH_CMD = /(^|\/)(npx|uvx|pipx|bunx)$|\bdlx\b/

export function registerExtensionInstallHandlers(): void {
  ipcMain.handle('extensions:previewInstall', (_e, kind: string, payload: Record<string, unknown>): InstallPreview => {
    try {
      if (kind === 'install_skill') {
        const dir = String(payload.dir_path ?? '')
        if (!dir) return { ok: false, error: 'No folder chosen yet' }
        const parsed = loadSkillDir(dir)
        return { ok: true, kind: 'skill', name: parsed.name, description: parsed.description, whenToUse: parsed.whenToUse, bodyPreview: parsed.body.slice(0, 500) }
      }
      if (kind === 'install_plugin') {
        const dir = String(payload.dir_path ?? '')
        if (!dir) return { ok: false, error: 'No folder chosen yet' }
        const parsed = parsePlugin(dir)
        return {
          ok: true,
          kind: 'plugin',
          name: parsed.manifest.name,
          version: parsed.manifest.version ?? '',
          skills: parsed.skills.map((s) => s.name),
          mcpServers: Object.keys(parsed.manifest.mcpServers ?? {}),
          roles: (parsed.manifest.roles ?? []).map((r) => r.name),
          hasHooks: !!parsed.manifest.hooks
        }
      }
      if (kind === 'install_mcp') {
        const transport = payload.transport === 'http' ? 'http' : 'stdio'
        const command = String(payload.command ?? '')
        const url = String(payload.url ?? '')
        const sourceDir = String(payload.source_dir ?? '')
        const sourceDirMissing = !!sourceDir && !existsSync(sourceDir)
        // Network warning: remote http always fetches remotely; a raw downloader command (npx …) pulls
        // the package at connect time. A local-folder server runs Studio's own copy → no warning.
        const netWarning = transport === 'http' || (!sourceDir && NET_FETCH_CMD.test(command.trim().split(/\s+/)[0] ?? ''))
        return { ok: true, kind: 'mcp', transport, command, args: (payload.args as string[]) ?? [], url, sourceDir, sourceDirMissing, netWarning, secretKeys: (payload.secret_keys as string[]) ?? [] }
      }
      return { ok: false, error: `unknown install kind: ${kind}` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('extensions:pickDir', (e) => pickDirectory(e, { title: 'Select the extension folder to install' }))

  ipcMain.handle('extensions:stashSecrets', (_e, values: Record<string, string>) => stashInstallSecrets(values))
}
