// Studio research — the RUN LIFECYCLE behind the `/research <question>` command. It is the direct-script path
// (handler → runScript), deliberately NOT registered into the workflow system: research is a single foreground
// review, not a saved asset. One durable artifact — a `research-launch` CARD row — carries the whole run: it is
// appended in a 'running' state, updated IN PLACE (updateMessageContent) as phases/logs arrive and once the
// cited report lands, and re-broadcast each time over the shared `conv:card` channel (the same insert-or-update
// plumbing workflow-draft cards use). The renderer card is a PURE function of that content, so live progress and
// a reload long after the run both render from the one persisted payload — no run table, no bespoke event stream.
//
// Sub-agents run under a picked expert (dispatch-ready + agent-loop capable, preferring an Anthropic-compatible
// endpoint because WebFetch's extractor speaks the Anthropic Messages API). They run QUIET in the ORIGIN
// conversation: usage is attributed there, no loose bubbles are persisted (the card is the only surface).

import { ulid } from '../../db/id'
import * as convService from '../conversation.service'
import * as convRepo from '../../repos/conversation.repo'
import * as rolesService from '../roles.service'
import * as endpointRepo from '../../repos/endpoint.repo'
import { protocolFamily } from '@shared/thinking'
import { broadcastConvCard } from '../../ipc/usage-broadcast'
import { registerLiveRun } from '../../agent/live-runs'
import { runResearchScript } from './agent-research'
import { formatReport } from './report'
import type { RunStepOptions } from '../coordinator/step'
import type { CoordinatorCallbacks } from '../coordinator/types'
import type { MessageDto } from '../../ipc/contracts'

export type ResearchStatus = 'running' | 'done' | 'failed' | 'stopped'

// The research card payload (segmentKind='research-launch', content = this JSON). `v` versions the shape; the
// renderer tolerates a missing field. `report` (markdown) + `stats` land on 'done'; `error` on 'failed'.
export interface ResearchCardPayload {
  v: 1
  runId: string
  question: string
  status: ResearchStatus
  roleId?: string
  phase?: string // current phase while running (Scope / Search / Fetch / Verify / Synthesize)
  note?: string // latest log line while running
  report?: string // the cited markdown report, on 'done'
  stats?: Record<string, number>
  error?: string // on 'failed'
}

interface LiveRun {
  controller: AbortController
  convId: string
  cardId: string
}
const live = new Map<string, LiveRun>()

export function isRunning(runId: string): boolean {
  return live.has(runId)
}

export function stop(runId: string): boolean {
  const r = live.get(runId)
  if (!r) return false
  r.controller.abort()
  return true
}

// app before-quit: abort every in-flight research run so its live web/LLM fetch streams tear down at once
// (the same hygiene workflow/coordinator runs get — an open socket keeps the process alive past quit).
export function abortAllResearchRuns(): void {
  for (const r of live.values()) r.controller.abort()
}

// Boot reconciliation (mirrors the assignment / workflow boot sweeps): nothing can be live at main-process
// startup — the `live` map is empty — so any research-launch card still persisted as 'running' is a crash/quit
// orphan from a previous session whose run died with the process and can never resolve, report, or be stopped
// (its controller is gone; research keeps no run table to reconcile against). Settle each to 'stopped' (honest —
// it was interrupted, never a fake 'done') so the card doesn't render a perpetual 'Researching…' with a dead
// Stop button. DB-only: no window has loaded a conversation yet, so openConversation reads the settled row on
// first open (no broadcast needed). Returns the count swept.
export function sweepInterruptedRuns(): number {
  let n = 0
  for (const row of convRepo.listBySegmentKind('research-launch')) {
    let payload: ResearchCardPayload
    try {
      payload = JSON.parse(row.content) as ResearchCardPayload
    } catch {
      continue // a corrupt payload renders as raw text, never a live run — skip
    }
    if (payload.status !== 'running') continue
    const settled: ResearchCardPayload = { ...payload, status: 'stopped', phase: undefined, note: undefined }
    if (convRepo.updateMessageContent(row.id, JSON.stringify(settled))) n++
  }
  return n
}

// Pick the expert whose endpoint the web-researcher sub-agents run under: dispatch-ready (bound + endpoint
// enabled) AND agent-loop capable (it must call WebSearch/WebFetch). Prefer an Anthropic-compatible endpoint —
// WebFetch's extraction call is hardcoded to the Anthropic Messages API, and WebSearch's non-gemini branch also
// speaks it; a pure-OpenAI binding would fetch nothing (the run then honestly reports an infra failure, but we
// avoid it when a better endpoint exists). Returns null when no expert is configured to run research at all.
function pickResearchRole(): string | null {
  const ready = rolesService
    .listBindings()
    .filter((b) => b.endpointId && rolesService.isDispatchReady(b.roleId) && rolesService.runsAgentLoop(b.roleId))
  if (ready.length === 0) return null
  const anthropic = ready.find((b) => {
    const ep = b.endpointId ? endpointRepo.getById(b.endpointId) : null
    return ep ? protocolFamily(ep.protocol) === 'anthropic' : false
  })
  return (anthropic ?? ready[0]).roleId
}

// A card-only noop sink: research sub-agents run QUIET (runRoleStep opens no segment, forwards no deltas/tools),
// so none of these fire in practice — the object only satisfies the type. requestPermission is never consulted
// on the agent path (it self-approves read-only web tools via coordinatorApproval); a defensive deny is safe.
function noopCallbacks(): CoordinatorCallbacks {
  return {
    onDispatch: () => {},
    onStepStart: () => {},
    onDelta: () => {},
    onStepDone: () => {},
    requestPermission: async () => ({ allow: false }),
  }
}

// Merge a patch into the card payload, persist it in place, and broadcast the updated row so every window with
// the conversation on screen re-renders the card. Best-effort: a deleted conversation (updateMessageContent
// false) simply stops the broadcast — the run continues and settles harmlessly.
function patchCard(convId: string, card: MessageDto, payload: ResearchCardPayload, next: Partial<ResearchCardPayload>): ResearchCardPayload {
  const merged = { ...payload, ...next }
  const content = JSON.stringify(merged)
  if (convRepo.updateMessageContent(card.id, content)) {
    broadcastConvCard(convId, { ...card, content })
  }
  return merged
}

export interface RunResearchInput {
  convId: string
  question: string
}

// Start a research run: validate, pick the role, append the running card (broadcast so it appears live), then
// execute the deep-research script in the BACKGROUND — the card updates as it progresses and once the report
// lands. Returns synchronously; the run's outcome rides the card, not the return value.
export function run(input: RunResearchInput): { ok: true; runId: string } | { ok: false; error: string } {
  const question = input.question.trim()
  if (!question) return { ok: false, error: 'A research question is required — e.g. /research what changed in HTTP/3 adoption in 2025' }
  if (!convService.get(input.convId)) return { ok: false, error: 'conversation not found' }
  const roleId = pickResearchRole()
  if (!roleId) {
    return { ok: false, error: 'No research-capable expert is configured. Bind an agent expert to an enabled endpoint (Anthropic-compatible preferred) and retry.' }
  }

  const runId = ulid()
  const initial: ResearchCardPayload = { v: 1, runId, question, status: 'running', roleId, phase: 'Scope' }
  const card = convService.append(input.convId, { author: 'expert', expertId: roleId, content: JSON.stringify(initial), segmentKind: 'research-launch' })
  broadcastConvCard(input.convId, card)

  const controller = new AbortController()
  // Register in the SHARED live-runs registry (the same mandatory step every run producer takes) so deleting
  // the origin conversation (conversation.service.remove → abortLiveRuns) or 停删-ing its project aborts this run
  // instead of leaving it burning web/LLM tokens into deleted rows + re-writing an rm'd session dir. Research
  // streams into the user's REAL conversation (unlike workflow's hidden conv), so this path is fully reachable.
  const unregister = registerLiveRun(input.convId, () => controller.abort())
  live.set(runId, { controller, convId: input.convId, cardId: card.id })
  void executeResearch({ convId: input.convId, card, question, roleId, controller, payload: initial }).finally(() => {
    live.delete(runId)
    unregister()
  })
  return { ok: true, runId }
}

async function executeResearch(ctx: {
  convId: string
  card: MessageDto
  question: string
  roleId: string
  controller: AbortController
  payload: ResearchCardPayload
}): Promise<void> {
  const { convId, card, question, roleId, controller } = ctx
  const signal = controller.signal
  let payload = ctx.payload

  const opts: RunStepOptions = {
    convId,
    roleId,
    prompt: '',
    dispatch: null,
    cb: noopCallbacks(),
    signal,
    cwd: convService.get(convId)?.cwd ?? '',
    permissionMode: 'default',
    includeHistory: false,
  }

  try {
    const result = await runResearchScript({
      opts,
      roleId,
      question,
      onPhase: (title) => {
        payload = patchCard(convId, card, payload, { phase: title })
      },
      onLog: (message) => {
        payload = patchCard(convId, card, payload, { note: message })
      },
    })

    if (signal.aborted) {
      patchCard(convId, card, payload, { status: 'stopped', phase: undefined, note: undefined })
      return
    }
    if (!result.ok) {
      patchCard(convId, card, payload, { status: 'failed', error: result.error, phase: undefined, note: undefined })
      return
    }
    const value = result.value as { stats?: Record<string, number> }
    patchCard(convId, card, payload, {
      status: 'done',
      report: formatReport(value),
      stats: value?.stats,
      phase: undefined,
      note: undefined,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    patchCard(convId, card, payload, {
      status: signal.aborted ? 'stopped' : 'failed',
      error: signal.aborted ? undefined : message,
      phase: undefined,
      note: undefined,
    })
  }
}
