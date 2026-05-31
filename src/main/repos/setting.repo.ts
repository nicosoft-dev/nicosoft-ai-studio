import { getDb } from '../db/connection'

// Settings table: key/value store where value is a JSON blob. Pure SQL — callers own the shape of
// T. Keys are app-level config groups (profile | general | privacy). UPSERT on conflict.

interface SettingRaw {
  value: string
}

export function get<T>(key: string): T | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as
    | SettingRaw
    | undefined
  return row ? (JSON.parse(row.value) as T) : null
}

export function set<T>(key: string, value: T): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, JSON.stringify(value))
}

export function remove(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
}
