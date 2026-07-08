// Materialize installed extensions into <dataDir>/extensions/ (docs/extension-install-design.md §4).
// Installing a skill/plugin used to only write a DB row pointing at the USER'S folder — move/delete that
// folder and the skill silently degrades to a stale snapshot. Materializing copies the payload into
// Studio's own data root so an install is self-contained, survives the original download being deleted,
// and is backup/sync-able. Naming: each entry is the extension row's own ULID id (same convention as
// sessions/<convId> and media/<convId>) — NOT a content hash, because edits mutate the copy in place.
//
//   extensions/skills/<skillId>/    imported: deep copy of the source folder (SKILL.md + assets)
//                                   builtin/distilled: a generated SKILL.md MIRROR of the DB body
//   extensions/plugins/<pluginId>/  deep copy of the whole plugin folder (its skills/* live inside)
//   extensions/mcp/<mcpId>.json     declarative manifest (never secrets — those stay in the keychain)
//   extensions/mcp/<mcpId>/         local-folder stdio servers only: copy of the server folder (run cwd)
//
// Existing rows installed before this feature keep their external dir_path untouched (no migration —
// design decision 2); only NEW installs are materialized.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { dataDir } from '../../db/connection'
import { ulid } from '../../db/id'

export type ExtensionKind = 'skills' | 'plugins' | 'mcp'

export function extensionsRoot(): string {
  return join(dataDir(), 'extensions')
}

// Ids come from our own ulid() (also the DB primary key), but removal builds paths from them — reject
// anything that isn't a plain path segment so a corrupt id can never traverse out of the root.
function safeSegment(id: string): string {
  if (!/^[0-9A-Za-z_-]+$/.test(id)) throw new Error(`invalid extension id: ${id}`)
  return id
}

// Generate the id for a new extension row BEFORE creating it, so the materialized copy and the DB row
// share one ULID (folder name = row id, 1:1).
export function newExtensionId(): string {
  return ulid()
}

export function materializedDir(kind: ExtensionKind, id: string): string {
  return join(extensionsRoot(), kind, safeSegment(id))
}

// True when a path already lives under extensions/ — e.g. a plugin-owned skill whose folder sits inside
// the plugin's materialized copy. Such paths are referenced in place, never copied a second time.
export function isMaterializedPath(p: string): boolean {
  return resolve(p).startsWith(resolve(extensionsRoot()) + sep)
}

// Deep-copy the user's source folder into extensions/<kind>/<id>/, replacing any prior copy for that id.
// dereference:true resolves symlinks so the copy is self-contained; .git and .DS_Store are dead weight
// for an installed extension and are skipped. Returns the internal path (what dir_path should store).
export function materializeDirCopy(kind: ExtensionKind, id: string, srcDir: string): string {
  if (!existsSync(srcDir)) throw new Error(`source folder not found: ${srcDir}`)
  const dest = materializedDir(kind, id)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  cpSync(srcDir, dest, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const b = basename(src)
      return b !== '.git' && b !== '.DS_Store'
    }
  })
  return dest
}

// Remove an extension's materialized payload (dir + the mcp manifest file). Best-effort by design: a
// missing entry (legacy row, or a mirror that failed to write) is a no-op, and removal must never block
// the DB delete it accompanies.
export function removeMaterialized(kind: ExtensionKind, id: string): void {
  const safe = safeSegment(id)
  try {
    rmSync(join(extensionsRoot(), kind, safe), { recursive: true, force: true })
    if (kind === 'mcp') rmSync(join(extensionsRoot(), 'mcp', `${safe}.json`), { force: true })
  } catch (e) {
    console.error('[extensions] failed to remove materialized payload', kind, id, e)
  }
}

// ---- MCP manifest (extensions/mcp/<id>.json) — the "mcp info lands in .nsai" projection ----
// Declarative config only. Secrets NEVER enter this file (keychain-only, by design decision 6), so a
// synced/backed-up manifest carries the shape of the server but not the credentials.

export interface McpManifest {
  id: string
  name: string
  transport: 'stdio' | 'http'
  endpointOrCmd: string
  args: string[]
  cwd: string | null
  scope: 'all' | string[]
}

export function writeMcpManifest(manifest: McpManifest): void {
  try {
    const dir = join(extensionsRoot(), 'mcp')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${safeSegment(manifest.id)}.json`), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
  } catch (e) {
    // A manifest is a projection of the DB row (the runtime source of truth) — failing to write it must
    // not fail the install. It self-heals on the next update of the same row.
    console.error('[extensions] failed to write mcp manifest', manifest.id, e)
  }
}

export function hasMcpManifest(id: string): boolean {
  return existsSync(join(extensionsRoot(), 'mcp', `${safeSegment(id)}.json`))
}

// ---- Skill mirror (extensions/skills/<id>/SKILL.md for builtin/distilled rows) ----
// The DB body stays the editing + runtime source of truth (dir_path remains NULL — resolveBody keeps
// reading the DB); the mirror only makes every skill visible on disk for backup/sync (decision 3).

export function writeSkillMirror(id: string, content: string): void {
  try {
    const dir = materializedDir('skills', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8')
  } catch (e) {
    console.error('[extensions] failed to write skill mirror', id, e)
  }
}
