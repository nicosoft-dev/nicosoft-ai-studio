import type { ConversationDto } from '@/lib/api'

// Resolve the Files-tree root cwd for a conversation (design §3 P17).
//
// Single-expert conversations use their primary role's cwd. Coordinator / collab conversations have an
// empty primary cwd (the coordinator never runs tools, so its cwd is "irrelevant" and usually unset) —
// fall back to the first non-empty cwd among the roles that actually participated (the dispatched experts
// that wrote files), in first-seen order. Mirrors collab-project's find-first-truthy. Returns null when
// nothing resolves → the Files panel shows its "no working directory" empty state.
export function resolveConvCwd(
  conv: ConversationDto | null,
  cwdByExpert: Record<string, string>,
  messages: { expertId?: string | null }[]
): string | null {
  if (!conv) return null
  // Per-conversation cwd is authoritative once the conversation has one (incl. an explicit '' = folder-free
  // reset state). conv.cwd === null means a legacy conversation that predates per-conv cwd → fall back to the
  // per-expert cwd below (so old chats keep resolving to the role's folder until the user re-picks).
  if (conv.cwd != null) return conv.cwd.trim() || null
  const primary = conv.primaryRoleId ? cwdByExpert[conv.primaryRoleId]?.trim() : ''
  if (primary) return primary
  const seen = new Set<string>()
  for (const m of messages) {
    const role = m.expertId
    if (!role || seen.has(role)) continue
    seen.add(role)
    const cwd = cwdByExpert[role]?.trim()
    if (cwd) return cwd
  }
  return null
}
