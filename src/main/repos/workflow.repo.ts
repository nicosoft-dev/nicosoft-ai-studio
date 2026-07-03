import { ulid } from '../db/id'
import { getDb } from '../db/connection'
import { asBool, asJson, buildUpdate, parseJson } from './_sql'
import type { WorkflowParamDto, WorkflowSource } from '../ipc/contracts'

// workflows CRUD. Pure SQL — no business logic. `script` is the single source of truth; name/description/
// params/cwd are parsed mirrors the SERVICE keeps in sync on every write (the read path never re-parses).
// No secrets here — a workflow carries prompts + a folder path only.

export interface WorkflowRow {
  id: string
  name: string
  description: string
  script: string
  params: WorkflowParamDto[]
  cwd: string | null
  enabled: boolean
  source: WorkflowSource
  originRole: string | null // distilled: proposing roleId; user/imported: null
  originConvId: string | null // distilled: conversation it was learned from
  createdAt: string
  updatedAt: string
}

export interface WorkflowCreateInput {
  name: string
  description: string
  script: string
  params: WorkflowParamDto[]
  cwd: string | null
  enabled: boolean
  source: WorkflowSource
  originRole?: string | null
  originConvId?: string | null
}

export interface WorkflowUpdatePatch {
  name?: string
  description?: string
  script?: string
  params?: WorkflowParamDto[]
  cwd?: string | null
  enabled?: boolean
}

interface WorkflowRaw {
  id: string
  name: string
  description: string | null
  script: string
  params: string
  cwd: string | null
  enabled: number
  source: string
  origin_role: string | null
  origin_conv_id: string | null
  created_at: string | null
  updated_at: string | null
}

function mapRow(raw: WorkflowRaw): WorkflowRow {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? '',
    script: raw.script,
    params: parseJson<WorkflowParamDto[]>(raw.params, []),
    cwd: raw.cwd,
    enabled: raw.enabled === 1,
    source: raw.source === 'imported' ? 'imported' : raw.source === 'distilled' ? 'distilled' : 'user',
    originRole: raw.origin_role,
    originConvId: raw.origin_conv_id,
    createdAt: raw.created_at ?? '',
    updatedAt: raw.updated_at ?? ''
  }
}

export function list(): WorkflowRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM workflows ORDER BY created_at ASC')
    .all() as unknown as WorkflowRaw[]
  return rows.map(mapRow)
}

export function getById(id: string): WorkflowRow | null {
  const row = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get(id) as unknown as
    | WorkflowRaw
    | undefined
  return row ? mapRow(row) : null
}

// Name is the slug identity (import conflict-suffixing + /workflow matching key on W2) — exact match only.
export function getByName(name: string): WorkflowRow | null {
  const row = getDb().prepare('SELECT * FROM workflows WHERE name = ?').get(name) as unknown as
    | WorkflowRaw
    | undefined
  return row ? mapRow(row) : null
}

export function create(input: WorkflowCreateInput): WorkflowRow {
  const id = ulid()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO workflows (id, name, description, script, params, cwd, enabled, source, origin_role, origin_conv_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name,
      input.description,
      input.script,
      JSON.stringify(input.params),
      input.cwd,
      input.enabled ? 1 : 0,
      input.source,
      input.originRole ?? null,
      input.originConvId ?? null,
      now,
      now
    )
  return getById(id) as WorkflowRow
}

export function update(id: string, patch: WorkflowUpdatePatch): WorkflowRow | null {
  const { sets, args } = buildUpdate([
    ['name', patch.name],
    ['description', patch.description],
    ['script', patch.script],
    ['params', asJson(patch.params)],
    ['cwd', patch.cwd],
    ['enabled', asBool(patch.enabled)],
  ])
  if (sets.length > 0) {
    getDb()
      .prepare(`UPDATE workflows SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...args, new Date().toISOString(), id)
  }
  return getById(id)
}

export function remove(id: string): void {
  getDb().prepare('DELETE FROM workflows WHERE id = ?').run(id)
}
