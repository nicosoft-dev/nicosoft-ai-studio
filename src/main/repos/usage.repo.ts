import { ulid } from '../db/id'
import { getDb } from '../db/connection'

// usage_events table: append-only token accounting. Pure SQL. `tool_calls` is JSON | null.
// `record` generates id + created_at internally.

export interface UsageRecordInput {
  conversationId?: string
  expertId?: string
  model: string
  provider: string
  inTokens: number
  outTokens: number
  toolCalls?: string[]
}

// Aggregate a conversation's settled usage. Every row here is a TURN-FINAL billing record (record() is
// called once per completed step/turn, never per streaming chunk) — so this sum is the safe source for a
// workflow run's Σ header (doc 39 discipline: never accumulate live stream deltas).
export function sumByConversation(conversationId: string): { inTokens: number; outTokens: number } {
  const row = getDb()
    .prepare(
      'SELECT COALESCE(SUM(in_tokens), 0) AS i, COALESCE(SUM(out_tokens), 0) AS o FROM usage_events WHERE conversation_id = ?'
    )
    .get(conversationId) as unknown as { i: number; o: number }
  return { inTokens: row.i, outTokens: row.o }
}

export function record(e: UsageRecordInput): void {
  const id = ulid()
  const createdAt = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO usage_events (id, conversation_id, expert_id, model, provider, in_tokens, out_tokens, tool_calls, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      e.conversationId ?? null,
      e.expertId ?? null,
      e.model,
      e.provider,
      e.inTokens,
      e.outTokens,
      e.toolCalls ? JSON.stringify(e.toolCalls) : null,
      createdAt
    )
}
