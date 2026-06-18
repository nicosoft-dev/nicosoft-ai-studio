import { getDb } from '../db/connection'

// extraction_state table — per-conversation memory-extraction control, replacing what Redis does in the
// server version: a CAS lock (coalescing, one extraction in flight per conversation), a turn counter
// (post-turn cadence), and an idle-due timestamp (the delayed idle trigger). One row per conversation.

export interface ExtractionState {
  conversationId: string
  lockUntil: string | null
  turnCounter: number
  idleDue: string | null
}

function ensure(convId: string): void {
  getDb()
    .prepare('INSERT INTO extraction_state (conversation_id, turn_counter) VALUES (?, 0) ON CONFLICT(conversation_id) DO NOTHING')
    .run(convId)
}

// CAS lock: acquire only if free or expired (an interrupted run can't wedge a conversation forever).
// `until` and `now` are ISO strings; returns true iff the lock was acquired.
export function tryLock(convId: string, until: string, now: string): boolean {
  ensure(convId)
  const res = getDb()
    .prepare('UPDATE extraction_state SET lock_until = ? WHERE conversation_id = ? AND (lock_until IS NULL OR lock_until < ?)')
    .run(until, convId, now)
  return Number(res.changes) > 0
}

export function unlock(convId: string): void {
  getDb().prepare('UPDATE extraction_state SET lock_until = NULL WHERE conversation_id = ?').run(convId)
}

export function incrTurn(convId: string): number {
  ensure(convId)
  getDb().prepare('UPDATE extraction_state SET turn_counter = turn_counter + 1 WHERE conversation_id = ?').run(convId)
  const row = getDb()
    .prepare('SELECT turn_counter FROM extraction_state WHERE conversation_id = ?')
    .get(convId) as unknown as { turn_counter: number }
  return row.turn_counter
}

export function setIdleDue(convId: string, due: string): void {
  ensure(convId)
  getDb().prepare('UPDATE extraction_state SET idle_due = ? WHERE conversation_id = ?').run(due, convId)
}

// Clear the idle timer. With `before`, only clear it when it hasn't been re-armed since — the sweep
// passes the timestamp it listed by, so a fresh turn's later idle_due survives a concurrent sweep.
export function clearIdle(convId: string, before?: string): void {
  if (before) {
    getDb()
      .prepare('UPDATE extraction_state SET idle_due = NULL WHERE conversation_id = ? AND idle_due IS NOT NULL AND idle_due < ?')
      .run(convId, before)
  } else {
    getDb().prepare('UPDATE extraction_state SET idle_due = NULL WHERE conversation_id = ?').run(convId)
  }
}

// Incremental-extraction watermark: the last message id (ULID — lexicographic = chronological) the
// extractor has already consumed for this conversation. Advancing it after every successful extraction
// keeps a long conversation from re-feeding the same tail to the extractor every cadence tick.
export function getLastExtracted(convId: string): string | null {
  const row = getDb()
    .prepare('SELECT last_extracted_id FROM extraction_state WHERE conversation_id = ?')
    .get(convId) as unknown as { last_extracted_id: string | null } | undefined
  return row?.last_extracted_id ?? null
}

export function setLastExtracted(convId: string, messageId: string): void {
  ensure(convId)
  getDb().prepare('UPDATE extraction_state SET last_extracted_id = ? WHERE conversation_id = ?').run(messageId, convId)
}

// Conversations whose idle timer has elapsed — the idle sweep extracts for each, then clears the timer.
export function listDue(now: string): string[] {
  const rows = getDb()
    .prepare('SELECT conversation_id FROM extraction_state WHERE idle_due IS NOT NULL AND idle_due < ?')
    .all(now) as unknown as { conversation_id: string }[]
  return rows.map((r) => r.conversation_id)
}

// Earliest pending idle_due across all conversations (ISO string), or null if none. Lets the memory
// service arm ONE timer to that exact instant instead of scanning on a fixed cadence.
export function nextIdleDue(): string | null {
  const row = getDb()
    .prepare('SELECT idle_due FROM extraction_state WHERE idle_due IS NOT NULL ORDER BY idle_due ASC LIMIT 1')
    .get() as unknown as { idle_due: string } | undefined
  return row?.idle_due ?? null
}
