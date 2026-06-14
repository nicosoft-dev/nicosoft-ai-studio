// Multi-lens Gate B — the CLOSED enum of orthogonal risk dimensions a lens can target.
// Design: docs/gate-b-multilens-amplifier.md §3.1. This is M0 of the rollout (§10) — the prerequisite gate.
//
// Why a CLOSED, code-owned enum (not model-chosen):
//   The lens TRIGGER is an LLM judgment; letting it self-certify "this is a distinct dimension" is the
//   fox-guarding-the-henhouse failure the stress test flagged (a model happily labels correctness /
//   soundness / robustness as three "dimensions"). So the dimension set lives HERE, in code; the trigger
//   may only PROPOSE keys from this enum, and dedup is mechanical (LENS_DIMENSION_KEYS + first-per-key).
//   The cap on lens count is therefore semantic = |enum|, enforced in code — not an arbitrary magic number.
//   Adding an 8th dimension is a deliberate code change naming a new risk axis, never a runtime knob.
//
// Why these seven and not "correctness":
//   The FLOOR verifier (COORDINATOR_VERIFIER_PROMPT + C-base, src/main/agent/roles/prompts.ts:69-86) already
//   judges correctness / duplication / wrong-problem HOLISTICALLY and HARD-FAILs on a pointable defect there
//   (prompts.ts:79). A lens MUST target an axis the floor does NOT scrutinize at depth — so correctness /
//   duplication / wrong-problem are deliberately EXCLUDED. Every dimension below carries a `floorGap` line
//   proving the floor underweights it; a lens here is ADDITIVE, never a re-run of the floor.

export type LensDimension =
  | 'security'
  | 'data-integrity'
  | 'perf'
  | 'concurrency'
  | 'error-handling'
  | 'api-contract'
  | 'migration-safety'
  | 'test-quality'

export interface LensDimensionMeta {
  key: LensDimension
  // Injected ADDITIVELY into the derived lens persona (§3.3): "ADDITIONALLY scrutinize <focus> deeply, on
  // top of your standard checks" — never "ONLY <focus>" (that would narrow and dilute the C-base floor).
  focus: string
  // Orthogonality proof (§3.1): why the floor verifier does NOT already cover this axis. The floor judges
  // correctness/duplication/wrong-problem and runs the build; these are the axes that survive a green build.
  floorGap: string
  // Content-driven trigger hints (§3.2). Path-localized hints feed the pure-regex pass (zero LLM); when a
  // small logic diff carries the risk in its SEMANTICS rather than its path (e.g. tightening a token check
  // inside a generically-named middleware file), the LLM trigger decides — these hints only seed the regex.
  // NOTE for M2's matcher: (1) a hint MAY intentionally seed >1 dimension when one path genuinely carries
  // multiple risk axes (e.g. 'query' → data-integrity + perf; 'schema' → api-contract + migration-safety) —
  // dedup is BY KEY, never by hint, so do NOT "dedupe the hints" (that would silently drop coverage).
  // (2) Match hints on PATH SEGMENTS / token boundaries, NOT raw substring — else 'ddl' (migration-safety)
  // would spuriously fire on every 'mi(ddl)eware' path. M2 owns this matcher discipline.
  pathHints: readonly string[]
}

export const LENS_DIMENSIONS: readonly LensDimensionMeta[] = [
  {
    key: 'security',
    focus:
      'security: auth / permission / crypto / injection / SSRF — does this change weaken an access check, ' +
      'leak a secret, widen trust, or open an injection / SSRF path?',
    floorGap:
      'A green build proves nothing about whether a 3-line edit weakened a token/permission check — the risk ' +
      'is in the access-control SEMANTICS, which the floor does not adversarially probe.',
    pathHints: ['auth', 'crypto', 'permission', 'session', 'token', 'ssrf', 'sanitize', 'middleware', 'secret', 'jwt'],
  },
  {
    key: 'data-integrity',
    focus:
      'data-integrity: DB writes / transaction atomicity / idempotency / consistency — can this corrupt, ' +
      'double-write, or leave partial state under failure or retry?',
    floorGap:
      'The floor checks the code compiles, not whether a write is transactional, idempotent, or consistent ' +
      'under a mid-operation failure — that requires reasoning about the DB interaction, not the diff alone.',
    pathHints: ['repo', 'transaction', 'tx', 'db', 'query', 'insert', 'update', 'delete', 'store', 'persist'],
  },
  {
    key: 'perf',
    focus:
      'perf: hot paths / N+1 / algorithmic complexity / memory — does this introduce a measurable regression ' +
      '(a loop over a query, an O(n^2), an unbounded allocation)? FAIL only on a pointable/measurable regression.',
    floorGap:
      'The floor runs build/typecheck, never a benchmark — a correct, compiling change can still ship an ' +
      'N+1 or a complexity blow-up that no green build reveals.',
    pathHints: ['loop', 'query', 'index', 'cache', 'batch', 'paginate', 'stream'],
  },
  {
    key: 'concurrency',
    focus:
      'concurrency: locks / races / ordering / process groups / parallel safety — can two callers interleave ' +
      'to corrupt state, deadlock, or leak a process/handle?',
    floorGap:
      'A single static read by the floor cannot see a race, a lock-ordering hazard, or a leaked process group ' +
      '— concurrency defects do not show up in a one-pass diff review or a single build.',
    pathHints: ['lock', 'mutex', 'async', 'concurrent', 'spawn', 'goroutine', 'channel', 'atomic', 'worker', 'pool'],
  },
  {
    key: 'error-handling',
    focus:
      'error-handling / resilience — are failures caught AND propagated, fallbacks actually reachable, ' +
      'abort / cancellation handled, with no swallowed exception or unhandled rejection? FAIL only on a ' +
      'pointable failure-path defect (empty catch, unreachable fallback, an error dropped) — never on style. ' +
      'Stay on the CONTROL-FLOW failure path; leave DB partial-state-under-retry to data-integrity.',
    floorGap:
      'A green build exercises only the happy path; it never proves a catch block is non-empty, a fallback ' +
      'is reachable, or a rejection is handled — failure-path soundness survives any compile.',
    pathHints: ['catch', 'fallback', 'recover', 'abort', 'rethrow', 'reject'],
  },
  {
    key: 'api-contract',
    focus:
      'api-contract: a change that COMPILES here but breaks an OUT-OF-REPO caller or a persisted/serialized ' +
      'consumer — an exported signature, wire format, or published contract that an in-repo build cannot ' +
      'reveal as broken. (The floor already watches in-repo contract breaks the build catches; this lens ' +
      'targets the cross-boundary ones it cannot.)',
    floorGap:
      'The floor judges the diff against the task in isolation; it does not enumerate external callers or ' +
      'wire consumers to confirm an exported signature / serialized shape stayed backward-compatible.',
    pathHints: ['api', 'dto', 'contract', 'export', 'interface', 'proto', 'schema', 'wire', 'public'],
  },
  {
    key: 'migration-safety',
    focus:
      'migration-safety: schema changes / backfills / backward compatibility / rollback — is the migration ' +
      'safe to apply on real data, reversible, and compatible with code still running the old schema?',
    floorGap:
      'The floor checks the migration code compiles, not whether the backfill is correct, the change is ' +
      'rollback-safe, or old-schema readers survive during a rolling deploy.',
    pathHints: ['migration', 'migrate', 'ddl', 'alter', 'schema', 'backfill', 'ensurecolumn'],
  },
  {
    key: 'test-quality',
    focus:
      'test-quality: do the tests actually run and assert? — are any vacuous, skipped, DB-gated-into-SKIP, or ' +
      'missing for a module the task explicitly named? (the strong-agent slip the big-project run caught.)',
    floorGap:
      'The floor runs typecheck + build and does NOT execute the test suite at all (prompts.ts:75) — so test ' +
      'EXECUTION plus quality (vacuous / silently SKIPped / DB-gated-into-SKIP / missing a mandated module) ' +
      'is entirely floor-uncovered; "it compiles" is not "the right tests run and assert the right thing".',
    pathHints: ['_test', '.test.', '.spec.', 'test/', '__tests__', 'testdata', 'fixture', 'mock'],
  },
]

// Mechanical dedup / validation surface (§3.1): the trigger's proposed keys are filtered against this set
// (drop anything not in the enum) and deduped by key (first-per-key wins) in CODE — never by asking the model.
export const LENS_DIMENSION_KEYS: ReadonlySet<LensDimension> = new Set(LENS_DIMENSIONS.map((d) => d.key))

// The hard ceiling on lenses per gated step = the number of orthogonal dimensions the team has defined.
// This is the SEMANTIC cap (§3.1), distinct from the physical concurrency cap min(16, cores−2) (§3.5).
export const MAX_LENS_DIMENSIONS = LENS_DIMENSIONS.length

// Resolve a proposed dimension key to its metadata, or null if it is not in the closed enum (dropped).
export function lensDimensionMeta(key: string): LensDimensionMeta | null {
  return LENS_DIMENSIONS.find((d) => d.key === key) ?? null
}
