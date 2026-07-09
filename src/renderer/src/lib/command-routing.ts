/* ============================================================
   NicoSoft AI Studio — /schedule and /workflow root-command routing (design doc §4)
   Pure logic (no React, no window) so the e2e harness imports it directly and pins the resolver matrix.
   Both commands share one grammar: bare = usage, "list" = list all, "<id|name> …" = act on one item.
   Resolution order: id exact → name exact (case-insensitive) → unique name prefix; ambiguity and misses
   return a typed error. A workflow target keeps its trailing `key=value` tail as `rest`; a schedule
   target takes the whole remainder as the name (no params).
   ============================================================ */

export interface RoutableItem {
  id: string
  name: string
}

export type RouteResult<T> =
  | { kind: 'usage' } // bare `/schedule` or `/workflow` — show how to use it
  | { kind: 'list' } // `… list` — show every item
  | { kind: 'run'; target: T; rest: string } // resolved to one item; `rest` = the k=v tail (workflow) or ''
  | { kind: 'error'; message: string } // ambiguous or no match — the message names the options

// Split "<name-or-id> [k=v k=v …]" into the leading name/id and the trailing run of `key=value` tokens.
// The k=v tail is whitespace-separated tokens that each look like `word=…` (value may be "quoted"); the
// preceding tokens join back into `head`, so a name with spaces works. A name containing '=' is not
// supported (documented) — its first `word=` token would be read as a parameter.
export function splitHeadAndKv(arg: string): { head: string; rest: string } {
  const tokens = arg.trim().match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  let firstKv = tokens.length
  for (let i = 0; i < tokens.length; i++) {
    if (/^[A-Za-z_][\w-]*=/.test(tokens[i])) {
      firstKv = i
      break
    }
  }
  return { head: tokens.slice(0, firstKv).join(' '), rest: tokens.slice(firstKv).join(' ') }
}

// Resolve a raw argument string against a list of items. `splitKv` = true parses a trailing k=v tail
// (workflow params); false takes the whole remainder as the name (schedule).
export function resolveTarget<T extends RoutableItem>(
  items: readonly T[],
  arg: string | undefined,
  splitKv: boolean
): RouteResult<T> {
  const trimmed = (arg ?? '').trim()
  if (!trimmed) return { kind: 'usage' }
  if (/^list$/i.test(trimmed)) return { kind: 'list' }

  const { head, rest } = splitKv ? splitHeadAndKv(trimmed) : { head: trimmed, rest: '' }
  // A leading key=value token (splitKv only) leaves an EMPTY head — the user typed params but named
  // nothing. An empty needle would prefix-match every item (and silently launch the sole one), so reject
  // it explicitly rather than resolve a name the user never typed.
  if (!head) return { kind: 'error', message: 'Name a workflow before its parameters.' }
  const needle = head.toLowerCase()

  // 1. id exact (ids are unique)
  const byId = items.find((x) => x.id === head)
  if (byId) return { kind: 'run', target: byId, rest }

  // 2. name exact, case-insensitive
  const exact = items.filter((x) => x.name.toLowerCase() === needle)
  if (exact.length === 1) return { kind: 'run', target: exact[0], rest }
  if (exact.length > 1) return { kind: 'error', message: ambiguity(exact) }

  // 3. unique name prefix, case-insensitive
  const prefix = items.filter((x) => x.name.toLowerCase().startsWith(needle))
  if (prefix.length === 1) return { kind: 'run', target: prefix[0], rest }
  if (prefix.length > 1) return { kind: 'error', message: ambiguity(prefix) }

  return { kind: 'error', message: `No match for “${head}”.` }
}

function ambiguity(matches: readonly RoutableItem[]): string {
  return `“${matches[0].name}” is ambiguous — matches ${matches.map((m) => m.name).join(', ')}. Use the id.`
}
