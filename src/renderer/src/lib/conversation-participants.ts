// The @-mention roster for a coordinator conversation, derived from its transcript. This is a PURE,
// renderer-only UX narrowing: the palette offers the experts this conversation has actually been talking
// to, but the SERVER still resolves an @mention against the full enabled roster (coordinator/route.ts
// matchMention), so a name the user types that isn't in this list still routes — the palette is a curated
// shortcut, never a gate. Kept JSX-free and dependency-free (no `@/` imports) so the unit test can import
// it directly: `node --experimental-transform-types e2e/conversation-participants.mts`.

export interface Participant {
  id: string
  name: string
  color: string
  disabled?: boolean // disabled/undispatchable NOW — still listed (dimmed), never removed (see below)
}

// Structural shapes — the caller passes real Expert / ChatMessage values; we only touch these fields, so
// staying structural keeps this module decoupled from the renderer's types (and the test dependency-free).
interface RosterExpert {
  name: string
  color: string
}
interface ParticipantMsg {
  role?: string
  expertId?: string | null
  dispatch?: readonly string[] | null
}

const COORDINATOR_ID = 'coordinator'

// The distinct experts who took part in this conversation, in first-seen order:
//   - the USER never appears (you don't @ yourself);
//   - the COORDINATOR (Danny) never appears — @Danny is just talking to Danny, the default target;
//   - a role dispatched but with no independently-visible message is still included (its id rides the
//     coordinator turn's dispatch[] chain);
//   - an id that doesn't resolve to a real expert — studio_lens and other tool/pseudo ids, or a deleted
//     custom role — is dropped, so only byId-resolvable roles reach the palette (design review R7).
// `disabledIds` MARKS (does not remove) roles disabled right now: an @mention is the user explicitly
// naming a role, so the palette still lists them dimmed — mirroring the server's rule of not
// readiness-filtering an explicit mention (dispatch then fails with an actionable error, never a silent
// reroute). `deletedIds` (optimistic renderer state for a just-removed role) IS removed — it's gone.
export function participantsOf(
  messages: readonly ParticipantMsg[],
  byId: Record<string, RosterExpert>,
  opts: { disabledIds?: ReadonlySet<string>; deletedIds?: ReadonlySet<string> } = {}
): Participant[] {
  const { disabledIds, deletedIds } = opts
  const seen = new Set<string>()
  const out: Participant[] = []
  const consider = (id: string | null | undefined): void => {
    if (!id || id === COORDINATOR_ID || seen.has(id)) return
    seen.add(id) // remember even ids we drop below, so a repeat doesn't re-run the checks
    if (deletedIds?.has(id)) return
    const e = byId[id]
    if (!e) return // dirty / tool / deleted id — never a candidate
    out.push({ id, name: e.name, color: e.color, disabled: disabledIds?.has(id) ? true : undefined })
  }
  for (const m of messages) {
    if (m.role === 'user') continue
    consider(m.expertId)
    if (Array.isArray(m.dispatch)) for (const d of m.dispatch) consider(d)
  }
  return out
}

// Detect a LEADING @mention in a sent message, mirroring the server's route.ts matchMention: longest
// display-name (or raw id) wins, the char after the name must be a word boundary (end / non-alphanumeric),
// case-insensitive. Renderer-only, used to highlight the @name chip in a user bubble (P3). Coordinator is
// excluded (@Danny isn't a routable mention). Returns the matched expert's color + the matched length, so
// the caller slices the exact typed text (casing intact) for the chip.
export function matchLeadingMention(
  text: string,
  experts: readonly { id: string; name: string; color: string }[]
): { id: string; color: string; matchedLen: number } | null {
  if (!text.startsWith('@')) return null
  let best: { id: string; color: string; len: number } | null = null
  for (const e of experts) {
    if (e.id === COORDINATOR_ID) continue
    for (const cand of new Set([e.name, e.id])) {
      const name = cand.trim()
      if (!name) continue
      if (text.slice(1, 1 + name.length).toLowerCase() !== name.toLowerCase()) continue
      const after = text[1 + name.length]
      if (after !== undefined && /[\p{L}\p{N}]/u.test(after)) continue // partial word — not this role
      if (!best || name.length > best.len) best = { id: e.id, color: e.color, len: name.length }
    }
  }
  return best ? { id: best.id, color: best.color, matchedLen: 1 + best.len } : null
}
