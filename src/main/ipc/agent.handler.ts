import { ipcMain, type WebContents } from 'electron'
import { join } from 'node:path'
import { ulid } from '../db/id'
import { LlmError } from '../llm/types'
import { broadcastBreakdown, broadcastConvImage, broadcastConvTodos, broadcastUsage } from './usage-broadcast'
import { StreamRegistry } from './stream-lifecycle'
import { CoalescerGroup } from './stream-coalesce'
import { PermissionBridge } from './permission-bridge'
import { serializeAssistantBlocks, serializeToolResults } from './agent-serialize'
import * as agentService from '../services/agent.service'
import * as assignmentService from '../services/assignment.service'
import { forwardLlmEvent, type RunStreamSink } from '../services/agent-dispatch'
import * as compressionService from '../services/compression.service'
import * as workspaceTasks from '../services/workspace/tasks'
import { sessionBus, type InjectionOutcome } from '../agent/session-bus'
import { registerLiveRun, liveRunCount } from '../agent/live-runs'
import { steerQueue, type SteerMessage } from '../agent/steer-queue'
import { getLiveCollab } from '../services/agent-collab'
import { matchMention } from '../services/coordinator/route'
import { drainSoloResume } from '../services/solo-async'
import { ENGINEER_ROLE_ID } from '../services/agent-tools'
import { isSoloPreviewWriteTool } from '../agent/tools/preview'
import * as convService from '../services/conversation.service'
import * as convRepo from '../repos/conversation.repo'
import { dataDir } from '../db/connection'
import { hookRegistry } from '../agent/hooks/registry'
import { runHooks } from '../agent/hooks/engine'
import { baseHookPayload, hookContextFromAgent } from '../agent/hooks/adapter'
import type { AgentContext } from '../agent/context'
import type { AgentPermissionResponse, AgentQuestionResponse, AgentRunInput, AgentSteerInput, AgentSteerResult } from './contracts'
import type { Tool } from '../agent/tool'

// Streaming agent over IPC. CONTROL stays on agent:* (`agent:run` starts a run and returns its streamId;
// `agent:stop` aborts; `agent:question`/`agent:permission:respond` bridge solo-only dialogs) — but the
// STREAM rides the same coordinator:* channels every other mode uses, tagged with this run's roleId:
// step:start → delta/reasoning/tool:start/sub-tool:*/assistant/results/compaction → step:done, then a
// terminal coordinator:done / coordinator:error. ONE wire shape, ONE renderer reducer; solo is just the
// single-role case of it (the drain unification — before this, solo spoke a parallel agent:* dialect and
// the renderer kept a second ~230-line handler suite for it).
const streams = new StreamRegistry()
// Abort every in-flight solo-agent run on app quit — see index.ts before-quit (clean teardown of live LLM streams).
export function abortAllAgentRuns(): void {
  streams.abortAll()
}
// Pending approvals: the shared bridge owns the Map + delete-guarded settle + terminal sweep; this handler
// supplies the agent:* emit callbacks (see requestPermission below).
const permissions = new PermissionBridge()
// AskUserQuestion: pending questions keyed by questionId; settle() resolves the loop's askUser promise. Solo-only
// (collab has no askUser), so its machinery stays local rather than in the shared bridge.
const pendingQuestions = new Map<string, (answer: string) => void>()
const pendingQByStream = new Map<string, Set<string>>()

// Resolve (deny) every still-pending permission for a run and drop its bucket — called on any terminal
// event so a prompt the renderer never answered can't linger in the maps forever.
function sweepStream(streamId: string): void {
  permissions.sweep(streamId) // deny + clear any approval the renderer never answered
  const qids = pendingQByStream.get(streamId)
  if (qids) {
    for (const id of qids) pendingQuestions.get(id)?.('(no answer — the run ended)')
    pendingQByStream.delete(streamId)
  }
}

// Start (or RESUME) a streamed agent run on a fresh streamId. Factored out of the agent:run handler so 批C2b's
// solo cross-turn park can drive a resumed run from the backend (a completed async op) with the SAME streaming +
// permission/question bridging a user-initiated run gets. opts.resumeNote marks a resume: it's pushed to the
// renderer up front (agent:resume-stream binds the new streamId to the conv) and handed to agent.service.run so
// it seeds the completion note instead of persisting a user turn.
// Exported for backend-orchestrated turns: the /workflow launch review (workflow.handler) drives a role
// turn through the SAME streaming/permission machinery a user-initiated run gets, with its per-run
// closure tool riding opts.extraTools.
// `settled` resolves when the run fully finishes (after the done/error wire events + idle release) — never
// rejects. It reports the injection-outcome contract (session-bus.ts): an ABORTED run resolves 'dropped'
// (its consuming turn was cut short — a scheduler chain must not run the next step on top of it); any other
// terminal, including an in-run error the conversation itself surfaces, resolves 'settled'. The session-bus
// delivery closure returns it so an injector (the scheduler's live chain) can await the resumed run; the
// IPC boundary strips it (a Promise doesn't survive structured clone).
export function startAgentRun(input: AgentRunInput, sender: WebContents, opts?: { resumeNote?: string; extraTools?: Tool[]; steerSeed?: SteerMessage[] }): { streamId: string; settled: Promise<InjectionOutcome> } {
  const streamId = ulid()
  const roleId = input.roleId ?? ENGINEER_ROLE_ID
  const { controller, send, finish } = streams.open(streamId, sender)
  // Conv-addressable abort (live-runs registry): conversation deletion — role delete, plugin uninstall,
  // direct delete — stops this run instead of leaving it streaming into deleted rows. The old role-delete
  // path only aborted coordinator UI runs; solo runs kept burning tokens (lifecycle review 2026-07-11).
  const offLive = registerLiveRun(input.convId, () => controller.abort())
  permissions.open(streamId)
  pendingQByStream.set(streamId, new Set())

  // A RESUME pushes a brand-new stream the renderer isn't subscribed to yet (the parked run's streamId already
  // closed on coordinator:done). Bind this streamId to the conv BEFORE any delta arrives so the resumed turn
  // streams into the same conversation. A user-initiated run is bound renderer-side from agent.run's returned
  // streamId. A steerSeed auto-continuation (R4) is the same shape: backend-started, unbound until this event.
  if (opts?.resumeNote != null || opts?.steerSeed?.length) {
    send('agent:resume-stream', {
      streamId,
      convId: input.convId,
      roleId,
      endpointId: input.endpointId,
      model: input.model,
    })
  }
  // Arm/refresh the conv's session-bus delivery with THIS run's sender + input (latest wins; a WebContents
  // survives a renderer reload, so it stays valid). Any session injection (a parked async op completing, a
  // Monitor change, a hook, a scheduled wakeup) drives it → a fresh resumed run on a new stream. markActive
  // claims the conv so an injection DURING this run defers its delivery to the run's idle (finally → markIdle)
  // — never two concurrent runs on one conv. The note is already wrapped in the notification shell by the bus.
  sessionBus.armDelivery(input.convId, (note) => startAgentRun(input, sender, { resumeNote: note }).settled)
  sessionBus.markActive(input.convId)

  // Assignments (docs/assignments-design.md §2b): a FRESH user-initiated solo run classifies its message at
  // receipt — a parallel small-model call (never blocking the run) that opens this role's work row the moment
  // it resolves isWork (a "continue" follow-up reopens the latest one instead). Not a new user ask → never
  // classify: a solo-async RESUME (resumeNote) continues the same parked turn, a backend-orchestrated
  // turn (workflow launch review — extraTools) is machinery, not the user handing over work, and a steerSeed
  // continuation (R4) consumes messages that steered the turn just ended — the same conversation thread.
  // The settle calls in then/catch await this promise, so a run that finishes before classification still closes its row.
  const pendingAssignment: Promise<string | null> =
    opts?.resumeNote != null || opts?.extraTools || opts?.steerSeed?.length
      ? Promise.resolve(null)
      : assignmentService.beginSoloRun({
          convId: input.convId,
          roleId,
          prompt: input.prompt,
          runId: streamId,
          endpointId: input.endpointId,
          model: input.model,
        })

  // Open this run's segment — same lifecycle every dispatched step announces (dispatch:null + no segmentKind
  // = a plain, non-dispatched run of this role). LAZY, fired just before the FIRST stream event: startAgentRun
  // runs synchronously inside the agent:run invoke, so a synchronous step:start would reach the renderer
  // BEFORE the invoke resolves and binds streamId → runMeta — a meta-miss that drops the segment open and
  // strands the optimistic placeholder. Every stream event is asynchronous (post-LLM-roundtrip), so opening
  // alongside the first one is always after the bind (send order per WebContents is preserved).
  let opened = false
  const ensureOpen = (): void => {
    if (opened) return
    opened = true
    send('coordinator:step:start', { streamId, roleId, dispatch: null, model: input.model })
  }
  // 16ms delta coalescing (streaming-render-alignment §3.1), one lane per (kind × roleId). Structural
  // events that land in the message stream (tool cards, assistant/results/compaction, step:done) call
  // flushAll() BEFORE they send, so buffered text can never arrive after a card emitted later than it.
  // High-rate sub_tool_delta stays direct (it only feeds an existing card's live tail — no ordering
  // dependency on text) and is NOT a flush point, so it can't defeat the batching window.
  const lanes = new CoalescerGroup()
  // The per-verb sink this run's stream events flow through — the SAME wire shape (coordinator:*) and the
  // SAME forwardLlmEvent mapping a dispatched step / collab expert uses; solo is the single-role case.
  // R4 (mid-turn steering): whether this run ended CLEANLY — the only terminal a leftover steered batch
  // auto-continues on. Set in .then below, read by the finally; abort/error/max_turns leave it false.
  let cleanFinish = false
  const sink: RunStreamSink = {
    onDelta: (roleId, text) => { ensureOpen(); lanes.lane(`t:${roleId}`, (t) => send('coordinator:delta', { streamId, roleId, text: t })).push(text) },
    onReasoning: (roleId, text) => { ensureOpen(); lanes.lane(`r:${roleId}`, (t) => send('coordinator:reasoning', { streamId, roleId, text: t })).push(text) },
    onToolStart: (roleId, id, name) => { ensureOpen(); lanes.flushAll(); send('coordinator:tool:start', { streamId, roleId, id, name }) },
    onToolInputDelta: (roleId, toolId, delta) => { ensureOpen(); send('coordinator:tool:input-delta', { streamId, roleId, toolId, delta }) },
    onToolEvent: (roleId, ev) => {
      // Only the AgentLlmEvent sub-tool lifecycle arrives here (forwardLlmEvent); assistant/results/compaction
      // ride onEvent below, so this stays a plain sub-tool forwarder.
      ensureOpen()
      if (ev.type === 'sub_tool_start') { lanes.flushAll(); send('coordinator:sub-tool:start', { streamId, roleId, ...ev }) }
      else if (ev.type === 'sub_tool_done') { lanes.flushAll(); send('coordinator:sub-tool:done', { streamId, roleId, ...ev }) }
      else if (ev.type === 'sub_tool_delta') send('coordinator:sub-tool:delta', { streamId, roleId, ...ev })
      else if (ev.type === 'sub_tool_progress') { lanes.flushAll(); send('coordinator:sub-tool:progress', { streamId, roleId, ...ev }) }
    },
    // Streaming usage: solo has no sub-steps, so usage stays a CONV-level broadcast (no roleId) — the live
    // overlay + the composer "/ window" meter read it; a roleId here would misroute it to segment-live state.
    onUsage: (_roleId, inputTokens, outputTokens, cachedTokens) => broadcastUsage(sender, input.convId, 'live', inputTokens, outputTokens, cachedTokens),
    onTurnFinalUsage: (usage) =>
      broadcastUsage(sender, input.convId, 'turn-final', usage.inputTokens, usage.outputTokens, usage.cacheReadInputTokens, usage.cacheCreationInputTokens),
  }

  const settled = agentService
    .run(
      input,
      {
          onStream: (ev) => forwardLlmEvent(sink, roleId, ev),
          onRetry: (info) => { ensureOpen(); send('coordinator:retry', { streamId, roleId, ...info }) },
          onEvent: (ev) => {
            ensureOpen()
            lanes.flushAll() // assistant/results/compaction land in the message stream — text first
            if (ev.type === 'assistant') send('coordinator:assistant', { streamId, roleId, blocks: serializeAssistantBlocks(ev.message.content) })
            else if (ev.type === 'compaction') send('coordinator:compaction', { streamId, roleId, kind: ev.kind, freedTokens: ev.freedTokens, phase: ev.phase })
            else send('coordinator:results', { streamId, roleId, results: serializeToolResults(ev.message.content) })
          },
          // The up-front per-turn count is the CURRENT context (count_tokens of what's being sent) → drives
          // the composer's "/ window" indicator.
          onUsage: (inputTokens) => broadcastUsage(sender, input.convId, 'context', inputTokens),
          onBreakdown: (b) => broadcastBreakdown(sender, input.convId, b),
          onTodos: (roleId, todos) => {
            broadcastConvTodos(sender, input.convId, roleId, todos)
            workspaceTasks.recordTodos(input.convId, roleId, todos) // Tasks-history phase capture (design §5 P30) — same seam as the live push
          },
          onToolImage: (attachment) => broadcastConvImage(sender, input.convId, attachment),
          requestPermission: (req, signal) => {
            if (isSoloPreviewWriteTool(req.toolName)) return Promise.resolve({ allow: true })
            // run-level abort (agent:stop / renderer-gone) AND turn-level abort (reactive compaction) both deny,
            // so the loop can unwind and the dialog clears. The bridge owns the delete-guarded settle + sweep.
            // The event rides coordinator:permission like every mode's approvals; the ANSWER still comes back on
            // agent:permission:respond (this handler's own bridge instance) — the renderer routes by stream kind.
            return permissions.request(
              streamId,
              [controller.signal, signal],
              (permissionId) => { lanes.flushAll(); send('coordinator:permission', { streamId, permissionId, roleId, toolName: req.toolName, input: req.input, reason: req.reason }) },
              (permissionId) => send('coordinator:permission:cancel', { streamId, permissionId }),
            )
          },
          askUser: (q, signal) =>
            new Promise<string>((resolve) => {
              const questionId = ulid()
              const settle = (answer: string, fromAbort = false): void => {
                pendingQByStream.get(streamId)?.delete(questionId)
                if (pendingQuestions.delete(questionId)) {
                  if (fromAbort) send('agent:question:cancel', { streamId, questionId })
                  resolve(answer)
                }
              }
              pendingQuestions.set(questionId, (answer) => settle(answer))
              pendingQByStream.get(streamId)?.add(questionId)
              const onAbort = (): void => settle('(question cancelled)', true)
              controller.signal.addEventListener('abort', onAbort, { once: true })
              signal?.addEventListener('abort', onAbort, { once: true })
              send('agent:question', { streamId, questionId, roleId, question: q.question, header: q.header, options: q.options })
            }),
        },
        controller.signal,
        { resumeNote: opts?.resumeNote, extraTools: opts?.extraTools, steerSeed: opts?.steerSeed },
      )
      .then((r): InjectionOutcome => {
        cleanFinish = r.reason === 'completed'
        // step:done settles the segment (authoritative text — mirrors the persisted row), then the terminal
        // done closes the stream: the exact two-beat every dispatched step ends with. ensureOpen covers a
        // degenerate zero-event run so the settle still has a segment to land on.
        ensureOpen()
        lanes.flushAll()
        send('coordinator:step:done', { streamId, roleId, text: r.text, inputTokens: r.contextTokens, outputTokens: r.outputTokens, sentTokens: r.sentTokens })
        send('coordinator:done', { streamId, inputTokens: r.contextTokens, outputTokens: r.outputTokens, reason: r.reason })
        // Assignments: the run settled — close this run's row (if classification opened/reopened one) with
        // the run's own terminal. Awaits the bounded classifier, so a fast run can't leak an orphan.
        void assignmentService.settleSoloRun(pendingAssignment, assignmentService.statusForRunReason(r.reason))
        // Injector-facing outcome: only a CLEAN finish is 'completed' — max_turns/thrash/incomplete/refusal
        // all ended abnormally, and an awaiting scheduler step must not be recorded ok on their strength.
        return r.reason === 'aborted' ? 'dropped' : r.reason === 'completed' ? 'completed' : 'failed'
      })
      .catch((err: unknown): InjectionOutcome => {
        const code = err instanceof LlmError ? err.code : 'unknown'
        const message = err instanceof Error ? err.message : String(err)
        lanes.flushAll()
        send('coordinator:error', { streamId, code, message })
        void assignmentService.settleSoloRun(pendingAssignment, controller.signal.aborted ? 'stopped' : 'failed')
        // An API/model error means the injected step never ran to completion — 'failed', not 'settled':
        // a scheduled chain stops and records the step honestly instead of sailing past a dead run.
        return controller.signal.aborted ? 'dropped' : 'failed'
      })
      .finally(() => {
        lanes.flushAll() // belt-and-suspenders: no armed timer may outlive the stream
        offLive() // the run is over — conv deletion must not "abort" it later
        workspaceTasks.finalizeConv(input.convId) // run silent → finalize an all-complete phase (design §5 P19)
        sweepStream(streamId) // deny any prompt the renderer never answered before the run ended
        finish()
        // Give solo-async its idle-transition re-check BEFORE releasing the conv: if the turn parked on async
        // ops that have all completed (and none is still in flight), it queues the resume now — re-evaluating
        // `awaiting` at the true end of the run so a late await isn't pre-empted. Then mark the conv idle LAST:
        // if this turn parked (or a Monitor/hook/schedule injection landed mid-run), this is where the resume
        // fires — a fresh run on a new stream, now that no run streams for the conv. The bus drains its queue here.
        drainSoloResume(input.convId)
        // R4 (mid-turn steering): steered messages that arrived after the loop's last fold point auto-continue
        // as a fresh run — this finally is the queue's LAST consumer, closing the enqueue-vs-drain race (the
        // agent:steer handler enqueues in the same tick as its isActive check, so nothing can slip between
        // this drain and markIdle). Only a CLEAN finish continues: an explicit Stop must stay stopped and an
        // error must not auto-retry into a failing endpoint — the discarded batch is already persisted, so
        // those messages simply ride the next user-initiated run as history. The continuation's own
        // markActive re-claims the conv, so markIdle is NOT called here — calling it would flush queued
        // session notes into a second concurrent run while the continuation streams; the continuation's own
        // finally releases the conv instead (user turns outrank notes, design §4.4).
        const leftovers = steerQueue.drain(input.convId, roleId)
        if (cleanFinish && leftovers.length) {
          try {
            startAgentRun(input, sender, { steerSeed: leftovers })
            return
          } catch (err) {
            console.warn(`[agent] steer auto-continue for conv ${input.convId} failed to start:`, err)
          }
        }
        sessionBus.markIdle(input.convId)
      })

  return { streamId, settled }
}

export function registerAgentHandlers(): void {
  // Return ONLY the streamId over IPC — `settled` is a Promise and would fail structured clone.
  ipcMain.handle('agent:run', (e, input: AgentRunInput): { streamId: string } => ({ streamId: startAgentRun(input, e.sender).streamId }))

  ipcMain.handle('agent:stop', (_e, streamId: string) => {
    streams.abort(streamId)
  })

  // Mid-turn steering (docs/mid-turn-steering-design.md §4.3/§5): a user message for a conversation whose
  // run is still streaming. Persist it as a REAL user turn (running its UserPromptSubmit hook exactly like
  // the ordinary send path does), then deliver mid-run:
  //   • SOLO (sessionBus active) — queue on the run's fold lane; the loop drains at its next request edge.
  //   • LIVE COLLAB — route by @mention (that expert) or, with no mention, broadcast to the whole team (the
  //     "default to coordinator" decision: Danny has no live loop mid-collab, so his relay is the broadcast).
  //     Running targets fold at their request edge; parked ones wake via the mailbox.
  //   • Neither, but runs are live (a dispatch pipeline / teardown race) — 'busy': NOT steerable and NOT safe
  //     to fall back to send (a second concurrent turn); the renderer keeps the draft.
  //   • Fully idle — 'boundary': the renderer falls back to the ordinary send path.
  // The active checks and the persist+enqueue commit run in one synchronous stretch, so a terminal drain can
  // never slip between them — an enqueued message is ALWAYS either folded mid-run or drained at a boundary.
  // NEVER wrapped in the session-bus notification shell: that shell says "NOT USER INPUT", the exact
  // opposite of what this is.
  ipcMain.handle('agent:steer', async (_e, req: AgentSteerInput): Promise<AgentSteerResult> => {
    // Persist + park on the conversation's role lane. The lane's LAST consumer starts the next turn with it
    // (coordinator.handler's terminal, agent.handler's finally) — and a role that happens to be running a
    // real agent loop on the same lane (Danny answering DIRECTLY) folds it at its next request edge instead,
    // whichever comes first. Either way Enter always lands: the bubble is on screen and the message runs.
    // Never enqueue without a live consumer: no run left → 'boundary' and the renderer sends normally. The
    // check and the commit are one synchronous stretch, and a run's terminal drain is likewise atomic, so
    // the two can't interleave — a queued message is ALWAYS drained by someone.
    const queueForBoundary = (r: AgentSteerInput, text: string): AgentSteerResult => {
      if (liveRunCount(r.convId) === 0) return { mode: 'boundary' }
      const row = convService.append(r.convId, { author: 'user', expertId: r.roleId, content: text })
      steerQueue.enqueue(r.convId, r.roleId, { text, msgId: row.id })
      return { mode: 'queued' }
    }
    const applyPromptHook = async (text: string): Promise<{ text: string } | { denied: string }> => {
      if (!hookRegistry.hasAny('UserPromptSubmit')) return { text }
      const conv = convRepo.getById(req.convId)
      const hookCtx: AgentContext = {
        cwd: conv?.cwd ?? '',
        signal: new AbortController().signal,
        roleId: req.roleId,
        convId: req.convId,
        permissionMode: 'default',
        sessionDir: join(dataDir(), 'sessions', req.convId),
        readFileState: new Map(),
        requestPermission: async () => ({ allow: false, message: 'Hooks cannot request tool permissions during prompt submission.' }),
        todos: [],
      }
      const promptHook = await runHooks(
        'UserPromptSubmit',
        { ...baseHookPayload('UserPromptSubmit', hookCtx), prompt: text, session_title: conv?.title ?? undefined },
        hookContextFromAgent(hookCtx),
      )
      if (promptHook.permissionBehavior === 'deny') return { denied: promptHook.permissionReason ?? (promptHook.blockingErrors.join('; ') || 'User prompt blocked by hook') }
      const rewritten = typeof promptHook.updatedInput?.prompt === 'string' ? promptHook.updatedInput.prompt : undefined
      let out: string
      if (promptHook.suppressOriginalPrompt) out = rewritten ?? (promptHook.additionalContexts.join('\n\n') || '[original prompt suppressed by hook]')
      else out = [rewritten ?? text, ...promptHook.additionalContexts].filter(Boolean).join('\n\n')
      if (promptHook.sessionTitle) convRepo.rename(req.convId, promptHook.sessionTitle)
      return { text: out }
    }

    // ── SOLO branch ──
    if (sessionBus.isActive(req.convId)) {
      const hooked = await applyPromptHook(req.text)
      if ('denied' in hooked) return { mode: 'denied', message: hooked.denied }
      // The hook awaited — the run may have ended meanwhile. Recheck before committing: enqueueing now with
      // no consumer left would strand the message in the queue AND double it into the next run's history.
      // (The boundary fallback re-runs the hook on the ordinary send path; hooks are expected idempotent.)
      if (!sessionBus.isActive(req.convId)) return { mode: 'boundary' }
      const row = convService.append(req.convId, { author: 'user', expertId: req.roleId, content: hooked.text })
      steerQueue.enqueue(req.convId, req.roleId, { text: hooked.text, msgId: row.id })
      return { mode: 'steered' }
    }

    // ── LIVE COLLAB branch ──
    if (getLiveCollab(req.convId)) {
      const hooked = await applyPromptHook(req.text)
      if ('denied' in hooked) return { mode: 'denied', message: hooked.denied }
      const collab = getLiveCollab(req.convId) // re-resolve: the hook awaited, the session may have torn down
      if (!collab) return queueForBoundary(req, hooked.text)
      // Leading @mention → that collab member; anything else (including a mention of a non-member) → the team.
      const m = matchMention(hooked.text, collab.roster())
      if (!collab.hasTarget(m?.id)) return queueForBoundary(req, hooked.text) // no live recipient → let it run as the next turn
      // Same-tick commit: persist (with the R5.1 audit target for a resolved mention) then route. hasTarget →
      // steer cannot race a teardown in between (single-threaded stretch, no await).
      const row = convService.append(req.convId, { author: 'user', expertId: req.roleId, content: hooked.text })
      const mentionText = m ? hooked.text.slice(0, m.matchedLen) : null
      if (m) convRepo.setMessageTarget(row.id, m.id, mentionText, m.matchedLen)
      collab.steer(hooked.text, row.id, m?.id)
      return m
        ? { mode: 'steered', targetRoleId: m.id, targetMentionText: mentionText ?? undefined, targetMentionLen: m.matchedLen }
        : { mode: 'steered' }
    }

    // ── a live turn with no request edge to fold into (Danny's route/dispatch/synthesis are single llmChat
    // calls) → queue it for the turn boundary; nothing live at all → boundary (renderer sends normally).
    if (liveRunCount(req.convId) === 0) return { mode: 'boundary' }
    const hooked = await applyPromptHook(req.text)
    if ('denied' in hooked) return { mode: 'denied', message: hooked.denied }
    return queueForBoundary(req, hooked.text) // re-checks liveness (the hook awaited — the turn may have ended)
  })

  ipcMain.handle('agent:permission:respond', (_e, resp: AgentPermissionResponse) => {
    permissions.respond(resp.permissionId, { allow: resp.allow, updatedInput: resp.updatedInput })
  })

  ipcMain.handle('agent:question:respond', (_e, resp: AgentQuestionResponse) => {
    pendingQuestions.get(resp.questionId)?.(resp.answer)
  })

  // Rebuild tool cards for a past conversation from its transcript (keyed by run_id).
  ipcMain.handle('agent:transcript', (_e, convId: string) => agentService.readTranscript(convId))

  // Manual compaction (the /compact command) — fold older history now, ignoring the 90% threshold.
  ipcMain.handle('agent:compact', (_e, convId: string) => compressionService.compactNow(convId))
  // Stop button while a manual compaction runs: abort the fold's LLM call — nothing is written, the
  // original agent:compact invoke resolves with {status:'cancelled'}.
  ipcMain.handle('agent:compact:cancel', (_e, convId: string) => compressionService.cancelCompact(convId))
}
