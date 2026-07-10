import * as skillRepo from '../../repos/skill.repo'
import { SkillManager } from '../../skills/manager'
import { loadSkillDir } from '../../skills/loader'
import * as settingsService from '../settings.service'
import { normalizeMemoryName as normalizeSlug } from '../memory/agent-memory'
import { isMaterializedPath, materializeDirCopy, newExtensionId, removeMaterialized, writeSkillMirror } from './materialize'
import type { SkillRow, SkillUpdatePatch } from '../../repos/skill.repo'
import type { SkillDto, SkillInput } from '../../ipc/contracts'
import type { LoadedSkill } from '../../skills/types'

// One SkillManager for the whole app — agent.service injects manager.skillTool(roleId) +
// manager.listingForRole(roleId). Imported skills re-read SKILL.md at call time; builtin skills carry
// their body inline. Registration mirrors enabled state: an enabled skill is in the manager, a disabled
// one is removed (so a role's listing/tool never advertises it).
export const manager = new SkillManager()

function toLoadedSkill(row: SkillRow): LoadedSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    whenToUse: row.whenToUse,
    source: row.source,
    body: row.body,
    dirPath: row.source === 'imported' ? row.dirPath : null,
    allowedTools: row.allowedTools
  }
}

function toDto(row: SkillRow): SkillDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    whenToUse: row.whenToUse,
    source: row.source,
    // builtin/distilled body lives in the DB and is surfaced (a distilled draft must be reviewable
    // before activation); imported body lives in the folder (not surfaced for edit).
    body: row.source !== 'imported' ? row.body : null,
    dirPath: row.dirPath,
    scope: row.scope,
    enabled: row.enabled,
    ownerPluginId: row.ownerPluginId,
    originRole: row.originRole
  }
}

function register(row: SkillRow): void {
  if (row.enabled) manager.set(row.id, toLoadedSkill(row), row.scope)
  else manager.remove(row.id)
}

// Mirror a builtin/distilled skill to extensions/skills/<id>/SKILL.md (materialize decision 3): every
// skill is visible on disk for backup/sync. The DB body stays the editing + runtime source of truth —
// dir_path stays NULL so resolveBody keeps reading the DB; the mirror is a pure projection.
function mirrorRow(row: SkillRow): void {
  if (row.source === 'imported') return // imported skills' folder copy IS the on-disk form already
  const fm = [
    '---',
    `name: ${row.name}`,
    `description: ${row.description.replace(/\r?\n/g, ' ')}`,
    ...(row.whenToUse ? [`when_to_use: ${row.whenToUse.replace(/\r?\n/g, ' ')}`] : []),
    '---',
    ''
  ].join('\n')
  writeSkillMirror(row.id, fm + (row.body ?? '') + '\n')
}

export function list(): SkillDto[] {
  return skillRepo.list().map(toDto)
}

export async function add(input: SkillInput, ownerPluginId?: string): Promise<SkillDto> {
  const row = input.source === 'imported' ? await createImported(input, ownerPluginId) : createBuiltin(input, ownerPluginId)
  mirrorRow(row)
  register(row)
  return toDto(row)
}

// Imported: parse the folder's SKILL.md (throws on missing file / empty body), MATERIALIZE the folder
// into extensions/skills/<id>/ (design §4.3 — the install owns its payload; the user deleting their
// download no longer breaks the skill), and snapshot its fields. A source already under extensions/
// (a plugin-owned skill inside the plugin's copy) is referenced in place — never copied twice.
async function createImported(input: SkillInput, ownerPluginId?: string): Promise<SkillRow> {
  if (!input.dirPath) throw new Error('Imported skill needs a folder path')
  const parsed = loadSkillDir(input.dirPath) // validate the SOURCE before copying anything
  const id = newExtensionId()
  const materialize = !isMaterializedPath(input.dirPath)
  const dirPath = materialize ? await materializeDirCopy('skills', id, input.dirPath) : input.dirPath
  try {
    return skillRepo.create({
      id,
      name: input.name?.trim() || parsed.name,
      description: input.description ?? parsed.description,
      whenToUse: input.whenToUse ?? parsed.whenToUse,
      source: 'imported',
      body: parsed.body,
      dirPath,
      allowedTools: parsed.allowedTools,
      scope: input.scope ?? 'all',
      enabled: input.enabled ?? true,
      ownerPluginId: ownerPluginId ?? null
    })
  } catch (e) {
    if (materialize) removeMaterialized('skills', id) // never leave an orphan copy behind a failed insert
    throw e
  }
}

// Builtin: author the instructions directly in studio. Name + body are required.
function createBuiltin(input: SkillInput, ownerPluginId?: string): SkillRow {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('Skill needs a name')
  const body = (input.body ?? '').trim()
  if (!body) throw new Error('Skill needs instructions')
  return skillRepo.create({
    name,
    description: input.description ?? '',
    whenToUse: input.whenToUse ?? '',
    source: 'builtin',
    body,
    dirPath: null,
    allowedTools: [],
    scope: input.scope ?? 'all',
    enabled: input.enabled ?? true,
    ownerPluginId: ownerPluginId ?? null
  })
}

export async function update(id: string, patch: SkillInput): Promise<SkillDto | null> {
  const existing = skillRepo.getById(id)
  if (!existing) return null
  let repatch: SkillUpdatePatch
  if (existing.source === 'imported') {
    // Re-parse the (possibly changed) folder so edits to SKILL.md are picked up on save. Editing a
    // materialized skill edits the INTERNAL copy (decision 5): same dirPath → re-read in place. Picking
    // a NEW external folder is a re-import → re-materialize it into this skill's own extensions/ copy
    // (the row keeps pointing inside .nsai). Legacy rows (external dirPath, no patch) stay untouched.
    let dirPath = patch.dirPath ?? existing.dirPath ?? ''
    if (patch.dirPath && patch.dirPath !== existing.dirPath && !isMaterializedPath(patch.dirPath)) {
      loadSkillDir(patch.dirPath) // validate the new source before replacing the copy
      dirPath = await materializeDirCopy('skills', existing.id, patch.dirPath)
    }
    const parsed = dirPath ? loadSkillDir(dirPath) : null
    repatch = {
      name: patch.name ?? parsed?.name,
      description: patch.description ?? parsed?.description,
      whenToUse: patch.whenToUse ?? parsed?.whenToUse,
      dirPath,
      body: parsed?.body,
      allowedTools: parsed?.allowedTools,
      scope: patch.scope,
      enabled: patch.enabled
    }
  } else {
    repatch = {
      name: patch.name,
      description: patch.description,
      whenToUse: patch.whenToUse,
      body: patch.body,
      scope: patch.scope,
      enabled: patch.enabled
    }
  }
  const updated = skillRepo.update(id, repatch)
  if (!updated) return null
  mirrorRow(updated)
  register(updated)
  return toDto(updated)
}

// — Skill distillation (docs/skill-distillation-design.md §3.2/§3.35) — the single write entry for
//   agent-authored skills, shared by the distill_skill tool (active path) and the gate-lesson upgrade
//   (passive path). Same name + same origin role → update in place (update-over-duplicate, keeping the
//   user's enabled decision); otherwise create a per-role DRAFT (enabled=false — invisible to
//   listing/tool until the user activates it in Extensions → Skills), unless the single opt-in setting
//   skills.autoActivateDistilled flips new ones straight to active. —

// Soft cap on ACTIVE distilled skills per role (§3.6 anti-bloat): at the cap, new creates are refused
// with a "consolidate first" outcome. Updates always pass (they don't grow the pool).
export const DISTILL_ACTIVE_CAP = 12

export interface DistillInput {
  name: string
  description: string
  whenToUse: string
  body: string
  originRole: string
  originConvId: string | null
}

export type DistillOutcome =
  | { kind: 'created' | 'updated'; name: string; active: boolean }
  | { kind: 'limit'; activeCount: number }

export function distillUpsert(input: DistillInput): DistillOutcome {
  // Enforce the slug the schemas only ASK for (same CC rule as memory names): the name is both the
  // Skill tool's invocation key and the update-over-duplicate match key, so "Kraken Backfill" and
  // "kraken-backfill" must normalize to ONE entry — especially for the gate path, whose small model
  // has no in-loop retry. Normalizing to empty (e.g. a fully non-latin name) rejects like empty input.
  const name = normalizeSlug(input.name.trim())
  if (!name) throw new Error('Skill needs a name')
  const body = input.body.trim()
  if (!body) throw new Error('Skill needs instructions')
  const rows = skillRepo.list()
  const existing = rows.find(
    (r) => r.source === 'distilled' && r.name === name && r.originRole === input.originRole
  )
  if (existing) {
    const updated = skillRepo.update(existing.id, {
      description: input.description,
      whenToUse: input.whenToUse,
      body
    })
    if (!updated) throw new Error('Skill update failed')
    mirrorRow(updated)
    register(updated)
    return { kind: 'updated', name, active: updated.enabled }
  }
  const activeCount = rows.filter(
    (r) => r.source === 'distilled' && r.originRole === input.originRole && r.enabled
  ).length
  if (activeCount >= DISTILL_ACTIVE_CAP) return { kind: 'limit', activeCount }
  const autoActivate = settingsService.get<boolean>('skills.autoActivateDistilled') === true
  const row = skillRepo.create({
    name,
    description: input.description,
    whenToUse: input.whenToUse,
    source: 'distilled',
    body,
    dirPath: null,
    allowedTools: [],
    scope: [input.originRole],
    enabled: autoActivate,
    originRole: input.originRole,
    originConvId: input.originConvId
  })
  mirrorRow(row)
  register(row)
  return { kind: 'created', name, active: row.enabled }
}

// Toggle only the enabled flag + re-register (used by the plugin enable/disable cascade).
export function setEnabled(id: string, enabled: boolean): SkillDto | null {
  const updated = skillRepo.update(id, { enabled })
  if (!updated) return null
  register(updated)
  return toDto(updated)
}

export function remove(id: string): void {
  manager.remove(id)
  skillRepo.remove(id)
  // Drop the materialized payload (imported copy / builtin mirror). No-op for legacy external rows and
  // for plugin-owned skills — their folder lives inside the PLUGIN's copy, removed by plugin uninstall.
  removeMaterialized('skills', id)
}

// App boot: register every enabled skill so a role's agent sees it on the first run.
export function loadEnabled(): void {
  for (const row of skillRepo.list()) {
    if (row.enabled) manager.set(row.id, toLoadedSkill(row), row.scope)
  }
}
