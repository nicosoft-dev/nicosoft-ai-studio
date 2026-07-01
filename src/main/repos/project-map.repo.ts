import { getDb } from '../db/connection'

// project_maps — the coordinator's per-project shape memory (coordinator dispatch §4). Pure SQL row CRUD,
// keyed by the NORMALIZED project cwd (the service layer owns normalization + the structural fingerprint).
// Mirrors the other repos (getDb + toRow); no ulid — the cwd IS the primary key (§4.2: keyed by cwd, not
// project_id). One row per project folder: recalled before an L1 routing investigation, upserted after it.

export interface ProjectMapRow {
  cwd: string
  fingerprint: string
  map: string
  projectId: string | null
  createdAt: string
  updatedAt: string
}
interface ProjectMapRaw {
  cwd: string
  fingerprint: string
  map: string
  project_id: string | null
  created_at: string
  updated_at: string
}
function toRow(r: ProjectMapRaw): ProjectMapRow {
  return {
    cwd: r.cwd,
    fingerprint: r.fingerprint,
    map: r.map,
    projectId: r.project_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function get(cwd: string): ProjectMapRow | null {
  const r = getDb().prepare('SELECT * FROM project_maps WHERE cwd = ?').get(cwd) as unknown as ProjectMapRaw | undefined
  return r ? toRow(r) : null
}

export interface ProjectMapUpsert {
  cwd: string
  fingerprint: string
  map: string
  projectId?: string | null
}
// Upsert by cwd: insert on first sight, otherwise refresh the map + fingerprint (and touch updated_at) so a
// later task on the same folder recalls the newest shape. created_at is preserved on update.
export function upsert(input: ProjectMapUpsert): void {
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO project_maps (cwd, fingerprint, map, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cwd) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         map         = excluded.map,
         project_id  = COALESCE(excluded.project_id, project_maps.project_id),
         updated_at  = excluded.updated_at`,
    )
    .run(input.cwd, input.fingerprint, input.map, input.projectId ?? null, now, now)
}
