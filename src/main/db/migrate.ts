import type { DatabaseSync } from 'node:sqlite'
import { SCHEMA_SQL } from './schema'

// Idempotent: every statement is CREATE TABLE/INDEX IF NOT EXISTS, so this is safe on every boot.
// Future breaking schema changes append versioned steps here behind a PRAGMA user_version gate.
export function runMigrations(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL)
}
