import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'node:path'
import { runMigrations } from './migrate'

// Single DatabaseSync instance for the main process. node:sqlite (Electron 42 / Node 24) — no
// native build step. Synchronous API is fine in the main process (it never blocks the renderer).
let instance: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (instance) return instance
  const file = join(app.getPath('userData'), 'nicosoft-studio.db')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db)
  instance = db
  return instance
}

export function closeDb(): void {
  instance?.close()
  instance = null
}
