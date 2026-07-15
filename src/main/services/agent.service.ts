// Engineer agent service — now a CHAT reply engine. A Engineer turn is one agent run, but it's wrapped in the
// chat layer: persist the user turn, recall memories + history from the conversation, inject them into
// the agent's system, run the ReAct loop, persist the final reply, then fire memory extraction +
// compression. The agent loop (agent/loop.ts) itself is unchanged — it just gets a richer system + a
// multi-turn seed. Tool steps stay in the per-session transcript (~/.nsai/sessions/<convId>/), not in
// the messages table; messages hold only the final reply (clean for memory extraction + history).
//
// This file owns run() (the chat-entry single run) + readTranscript (tool-card rebuild for the renderer).
// The section modules carry the rest: agent-tools (role→tool kits + shared role sets), agent-dispatch
// (the shared loop core + coordinator-dispatched runs + AgentCallbacks), agent-collab (multi-expert
// collaboration), agent-system (system-prompt building).

import { existsSync, readFileSync } from 'node:fs'
import { dataDir } from '../db/connection'
import { join } from 'node:path'
import { ulid } from '../db/id'
import { buildToolsParam, type AgentResult } from '../agent/loop'
import { autocompactThreshold } from '../agent/compact'
import type { AgentMessage, ServerToolSchema } from '../agent/types'
import { parseTranscript } from './transcript-parse'
import { lspTool } from '../agent/tools/lsp'
import { awaitAsyncTool } from '../agent/tools/await-async'
import { launchAsyncTool } from '../agent/tools/launch-async'
import type { Tool } from '../agent/tool'
import type { AgentRunInput, RunTranscript } from '../ipc/contracts'
import { requireApiKey } from './credentials'
import { protocolFamily } from '@shared/thinking'
import { LlmError } from '../llm/types'
import * as endpointRepo from '../repos/endpoint.repo'
import * as convRepo from '../repos/conversation.repo'
import * as summaryRepo from '../repos/summary.repo'
import * as usageRepo from '../repos/usage.repo'
import * as convService from './conversation.service'
import * as rolesService from './roles.service'
import * as memoryService from './memory/service'
import * as compressionService from './compression.service'
import { pickSmallModel } from './model-select'
import { recallText } from './memory/project-map'
import { indexText as agentMemoryIndexText } from './memory/agent-memory'
import { countBreakdown, countContext, roughMessageTokens } from './token-count.service'
import * as contextAnchor from './context-anchor'
import { MAX_REPLAY_IMAGES } from '../media/storage'
import { manager as skillManager } from './extensions/skill'
import { DEV_ROLES, ENGINEER_ROLE_ID, PLAYWRIGHT_TOOLS, SERVICE_TOOLS, SUBAGENT_TOOLS, toolsForAgentRole } from './agent-tools'
import { buildAgentSystem } from './agent-system'
import { conversationToAgentMessages, countReplayImages, runAgentLoop, type AgentCallbacks } from './agent-dispatch'
import type { AgentContext } from '../agent/context'
import { runHooks } from '../agent/hooks/engine'
import { hookRegistry } from '../agent/hooks/registry'
import { baseHookPayload, hookContextFromAgent } from '../agent/hooks/adapter'
import { getSoloAsync, parkSolo } from './solo-async'

// 批C2b: a RESUME is a turn the runtime starts itself after a parked async op completes — not a user message.
// resumeNote carries the completion summary; in resume mode we do NOT persist a user turn (no robotic user
// bubble) and seed the note as the trailing user turn so the agent continues. The assistant reply persists
// normally, so the follow-up is durable. The synthetic 'user' framing is the standard way to feed a tool/async
// result back into the loop (the model's own seed always ends on a user turn).
export async function run(
  input: AgentRunInput,
  cb: AgentCallbacks,
  signal: AbortSignal,
  // extraTools (§7.5): per-RUN closure tools appended to the role kit — the machine-protocol channel for
  // backend-orchestrated turns (e.g. the /workflow launch review submits its decision through one). Main-
  // process callers only (a Tool can't cross IPC); never persisted, gone next turn.
  opts?: { resumeNote?: string; extraTools?: Tool[] },
): Promise<{ reason: AgentResult['reason']; turns: number; convId: string; runId: string; text: string; promptTokens: number; contextTokens: number; outputTokens: number; sentTokens: number }> {
  const ep = endpointRepo.getById(input.endpointId)
  if (!ep) throw new LlmError('bad_request', 'endpoint not found')
  // The agent loop speaks Anthropic Messages (/v1/messages), OpenAI Responses (/v1/responses), or Gemini
  // generateContent (/v1beta/models/*:streamGenerateContent) tool use.
  const protocol = protocolFamily(ep.protocol)
  if (!protocol) throw new LlmError('bad_request', `agent does not support ${ep.protocol} endpoints yet`)
  const key = requireApiKey(input.endpointId)

  const convId = input.convId
  const runId = ulid()
  // Tools scoped to this agent role: a CORE subset (doc 16 §5) + MCP + Skill, by roleId + scope.
  const roleId = input.roleId ?? ENGINEER_ROLE_ID
  // A role the user turned OFF must NEVER run — not even its OWN solo/scheduled/workflow conversation. The
  // same centralized precondition runRoleStep applies to coordinator dispatch; solo/scheduled/workflow all
  // funnel here, so this is their enforcement point. Thrown before any side effect (no user turn persisted,
  // no hook fired for a rejected run). Coordinator/enabled roles pass through untouched.
  rolesService.assertRoleExecutable(roleId)
  let submittedPrompt = input.prompt
  let userPromptContexts: string[] = []
  let tools = [...toolsForAgentRole(roleId), launchAsyncTool, awaitAsyncTool] // 批C2a: solo direct chat can launch/await async ops (studio_lens launches through ctx.async too)
  if (DEV_ROLES.has(roleId)) tools = [...tools, ...SERVICE_TOOLS, ...PLAYWRIGHT_TOOLS, ...SUBAGENT_TOOLS, lspTool as unknown as Tool] // preview_* moved into toolsForAgentRole (universal)
  if (opts?.extraTools?.length) tools = [...tools, ...opts.extraTools] // per-run closure tools (backend-orchestrated turns)
  // Read needs a folder boundary; without a cwd, drop it for non-dev roles so the model can't read the
  // process working dir. Dev roles (Flynn/Shuri) always have a cwd (required in the composer).
  if (!input.cwd && !DEV_ROLES.has(roleId)) tools = tools.filter((t) => t.name !== 'Read')
  // Server-side web search via OpenAI's hosted web_search (doc 16 §4) — results return as a web_search_call
  // server block. Gemini is NOT added here: its google_search grounding 400s when combined with
  // functionDeclarations, and the agent loop always sends tools — so Gemini (and Anthropic, which has no
  // hosted search) use the local WebSearch tool instead, which fires an ISOLATED search request free of tools.
  const serverTools: ServerToolSchema[] = protocol === 'openai' ? [{ type: 'web_search', name: 'web_search' }] : []

  // ① Persist the user turn (tagged with run_id) so context assembly + extraction read it from the DB. SKIP on a
  // resume (批C2b): the completion note isn't the user's words — persisting it would inject a robotic user bubble.
  // The note is seeded only into this run's in-memory seed below; the assistant's reply still persists.
  if (opts?.resumeNote == null) {
    if (hookRegistry.hasAny('UserPromptSubmit')) {
      const hookCtx: AgentContext = {
        cwd: input.cwd,
        signal,
        roleId,
        runId,
        convId,
        permissionMode: input.permissionMode ?? 'default',
        sessionDir: join(dataDir(), 'sessions', convId),
        readFileState: new Map(),
        requestPermission: async () => ({ allow: false, message: 'Hooks cannot request tool permissions during prompt submission.' }),
        todos: [],
      }
      const promptHook = await runHooks(
        'UserPromptSubmit',
        { ...baseHookPayload('UserPromptSubmit', hookCtx), prompt: input.prompt, session_title: convRepo.getById(convId)?.title ?? undefined },
        hookContextFromAgent(hookCtx),
      )
      if (promptHook.permissionBehavior === 'deny') throw new LlmError('bad_request', promptHook.permissionReason ?? (promptHook.blockingErrors.join('; ') || 'User prompt blocked by hook'))
      const rewritten = typeof promptHook.updatedInput?.prompt === 'string' ? promptHook.updatedInput.prompt : undefined
      userPromptContexts = promptHook.additionalContexts
      if (promptHook.suppressOriginalPrompt) submittedPrompt = rewritten ?? (userPromptContexts.join('\n\n') || '[original prompt suppressed by hook]')
      else submittedPrompt = [rewritten ?? submittedPrompt, ...userPromptContexts].filter(Boolean).join('\n\n')
      if (promptHook.sessionTitle) convRepo.rename(convId, promptHook.sessionTitle)
    }
    const userImages = (input.images ?? []).map((i) => ({ url: i.dataUrl }))
    convService.append(convId, {
      author: 'user',
      expertId: roleId,
      content: submittedPrompt,
      attachments: userImages,
      runId,
    })
  }

  // ② chat-layer context: recall memories + the history after the latest summary's boundary + summary.
  const memories = await memoryService.recall({
    convId,
    roleId,
    endpointId: input.endpointId,
    model: input.model,
  })
  const history = convRepo.listByConversation(convId)
  let summary = summaryRepo.getLatest(convId)
  const afterBoundary = (rows: typeof history, s: typeof summary): typeof history =>
    s?.coveredUpTo != null ? rows.filter((m) => m.id > s.coveredUpTo!) : rows
  let recent = afterBoundary(history, summary)

  // ③ Agent system = ENGINEER prompt + injected memories + summary; seed = history → AgentMessage (Anthropic
  //    needs a user-first list, so drop any leading assistant turns left by a fold boundary).
  // §4: inject the SYSTEM-WIDE project map (if this cwd has a remembered one) so a solo agent orients like the
  // dispatched/collab paths — read-only; Danny's routeAsAgent stays the sole writer.
  // buildSeed is re-runnable on purpose: the pre-run seed gate below can fold history between the first
  // build and the loop start, and the rebuilt seed must re-apply the SAME trailing-turn branches.
  const [projectMapText, memoryIndexText] = await Promise.all([recallText(input.cwd), agentMemoryIndexText(input.cwd)])
  let system = buildAgentSystem(roleId, memories, summary?.content ?? null, skillManager.listingForRole(roleId), input.cwd, false, projectMapText, memoryIndexText)
  const buildSeed = (recentRows: typeof recent): { seed: AgentMessage[]; seedIsRecent: boolean } => {
    const mapped = conversationToAgentMessages(recentRows)
    const firstUser = mapped.findIndex((m) => m.role === 'user')
    let seed = firstUser > 0 ? mapped.slice(firstUser) : mapped
    // The context anchor's whole contract is that the seed IS `recent` rendered — it prices `recent` up to a
    // watermark and the next turn adds what came after. Both branches below append content that was never
    // persisted, so the seed stops corresponding to any message id and the correspondence breaks in both
    // directions: reading would miss the extra turn's cost, and recording would fold it into a price we then
    // attribute to `recent` alone and re-add forever. Neither is worth a special case — count for real instead.
    // (The leading-assistant slice just above is harmless by contrast: it only drops from the FRONT, before any
    // watermark, and the server's price already reflects the drop.)
    let seedIsRecent = true
    if (opts?.resumeNote != null) {
      // 批C2b resume: deliver the completion note as the trailing user turn (in-memory only — not persisted). The
      // parked turn USUALLY left an assistant reply ("launched X, awaiting…"), so history ends on assistant and we
      // append a fresh user turn. But if that turn was a pure tool-call with NO prose, nothing persisted and history
      // ends on the user's ORIGINAL turn — appending another user turn would put two in a row (some upstreams 400).
      // Fold the note into that trailing user turn instead so the seed stays well-formed (user/assistant alternation).
      const last = seed[seed.length - 1]
      if (last && last.role === 'user') {
        seed = [...seed.slice(0, -1), { role: 'user', content: [...last.content, { type: 'text', text: `\n\n${opts.resumeNote}` }] }]
      } else {
        seed = [...seed, { role: 'user', content: [{ type: 'text', text: opts.resumeNote }] }]
      }
      seedIsRecent = false
    } else if (seed.length && seed[seed.length - 1].role === 'assistant') {
      // Claude-OAuth-routed upstreams reject assistant prefill ("the conversation must end with a user message"); the
      // native API tolerates it. History normally ends on the just-persisted user prompt, but guard the invariant here
      // too so a persistence-order change can't reintroduce a routed 400.
      seed = [...seed, { role: 'user', content: [{ type: 'text', text: submittedPrompt }] }]
      seedIsRecent = false
    }
    return { seed, seedIsRecent }
  }
  let { seed, seedIsRecent } = buildSeed(recent)

  // This run's starting context (system + seed + tool schemas). Drives the composer readout + the panel.
  // PREFER THE SERVER'S OWN PRICE. Every turn of this conversation was already priced by the server, and the
  // last one's figure is in the anchor — so all that is left to estimate is what got appended since, which is
  // the reply and the new user turn. Counting the whole payload instead is re-deriving a known number, and
  // measurement says both ways of doing that are wrong by a constant that lives entirely in the tools term:
  // openai +105% (roughCount prices schemas at chars/2), anthropic −1837 every single time (count_tokens is
  // sent the kit with its server tools stripped, and nothing prices them back). See context-anchor.ts.
  // No anchor — first turn here, or an app restart, or the history was rewritten — is the cold start, and only
  // then do we count for real.
  const toolSchemas = buildToolsParam(tools, input.model)
  const toolsFp = contextAnchor.fingerprint(toolSchemas)
  let anchored = seedIsRecent
    ? contextAnchor.read(convId, roleId, {
        model: input.model,
        toolsFp,
        coveredUpTo: summary?.coveredUpTo,
        msgIds: recent.map((m) => m.id),
        images: countReplayImages(recent),
        maxImages: MAX_REPLAY_IMAGES,
      })
    : null
  // Render the tail through the REAL seed mapping rather than re-deriving it per message: image replay is a
  // whole-list decision, so a hand-rolled per-message estimate would diverge from what actually gets sent.
  const anchorWatermark = anchored?.upToMsgId
  let promptTokens = anchored
    ? contextAnchor.combine(
        anchored,
        conversationToAgentMessages(recent.filter((m) => m.id > anchorWatermark!)).reduce((sum, m) => sum + roughMessageTokens(m.content), 0),
        system.length,
      )
    : await countContext(protocol, {
        baseUrl: ep.baseUrl,
        apiKey: key,
        model: input.model,
        system,
        messages: seed as { role: string; content: unknown }[],
        tools: toolSchemas,
        thinkingBudget: input.thinking?.budgetTokens,
        smallModel: pickSmallModel(protocol, ep.availableModels, input.model)
      })

  // ③b Pre-run seed gate — the structural contract between the two compaction layers. The loop's proactive
  // autocompact fires at autocompactThreshold(window); chat-layer folding fires at 90%. For windows under
  // ~330K the loop's trigger is the LOWER one, so a seed in the band between them would trip the loop into
  // folding persisted history IN MEMORY — a full-transcript summary call whose result is discarded with the
  // run, re-paid by every later run (agent-dispatch's foldedBeforeFirstTurn documents the turn-1 case; the
  // anchored estimate makes turn 2+ just as reachable). Fold it HERE instead: once, persisted into the
  // summary chain, before the loop ever sees it — after this gate every proactive fold the loop makes is
  // genuine in-run growth. Same window fallback as the loop (loop.ts) so the two triggers never diverge.
  // maybeCompress brings its own guards: the compaction floor (arithmetic proof, per trigger value),
  // too-few, and the per-conv busy lock (a post-turn fold still in flight → skip, the seed rides once more
  // as-is). One shot by construction — no loop, and a fold that lands leaves the seed under the trigger.
  const runWindow = input.contextWindow ?? 200_000
  let gateFolded = false
  if (promptTokens > autocompactThreshold(runWindow)) {
    const folded = await compressionService.maybeCompress({
      convId,
      roleId,
      endpointId: input.endpointId,
      model: input.model,
      contextWindow: input.contextWindow,
      currentTokens: promptTokens,
      threshold: autocompactThreshold(runWindow),
    })
    if (folded.status === 'compacted') {
      // History rows are untouched by a fold (only the summary boundary moved), so re-derive from the same
      // snapshot. The system prompt embeds the summary text — it must be rebuilt, not patched.
      summary = summaryRepo.getLatest(convId)
      recent = afterBoundary(history, summary)
      system = buildAgentSystem(roleId, memories, summary?.content ?? null, skillManager.listingForRole(roleId), input.cwd, false, projectMapText, memoryIndexText)
      ;({ seed } = buildSeed(recent))
      // The fold just moved the summary boundary, so the anchor no longer describes this seed (read()
      // rejects on coveredUpTo drift) — and this turn's figure is now an arithmetic correction, not a
      // server price. Clearing `anchored` keeps the breakdown's heavy verdicts and the token-diag tiers
      // honest; the loop's first turn re-anchors from real usage. Same correction the manual /compact
      // receipt applies (stores/chat.ts): the next real measurement supersedes it.
      anchored = null
      gateFolded = true
      promptTokens = Math.max(0, promptTokens - folded.foldedTokens + folded.summaryTokens)
    }
  }

  // Surface the prompt size to the UI BEFORE the loop's first turn streams — so the live readout shows
  // ↑ tokens during the initial thinking phase (and every between-turns gap), not only after onDone.
  cb.onUsage?.(promptTokens)

  // What that prompt is MADE OF, for the composer's Context window panel — resolved by differencing four
  // more probes (see countBreakdown). Strictly a SIDE ROAD: fire-and-forget, after onUsage, never awaited.
  // The count above blocks in front of every turn and drives the compression threshold as well as the
  // readout, so making the panel's extra probes wait in that queue would add a round trip to the start of
  // every single turn. Free (count_tokens is not billed) is not the same as free of latency.
  // Its own failure is silent by design: the panel is an aid, and a probe that 500s must not touch the run.
  // No known window → no panel to fill (the indicator hides itself too), so don't probe at all.
  if (cb.onBreakdown && input.contextWindow) {
    const contextWindow = input.contextWindow
    // Everything, INCLUDING the shadow system build, happens inside the async boundary. buildAgentSystem is
    // NOT pure — it reads the project's convention files off disk — so calling it out here would put that
    // synchronous I/O back on the turn's critical path, and let a transient throw take the run down with it.
    // `announce: false` is the other half: reading those files is what fires the user's InstructionsLoaded
    // hook, and a build that exists only to be counted must not pose as a real load (it would run the hook
    // twice per turn, with a payload identical to the genuine one).
    void (async () => {
      // The same system prompt minus ONLY the recalled memories + the memory index — the project map stays
      // in (it is part of the prompt proper, not auto-memory).
      const systemNoMemory = buildAgentSystem(roleId, [], summary?.content ?? null, skillManager.listingForRole(roleId), input.cwd, false, projectMapText, undefined, false)
      const b = await countBreakdown(
        protocol,
        // NOTE: no smallModel — deliberately. The L2 fallback is a REAL max_tokens:1 request, i.e. billed;
        // spending four of those per turn to shade a panel is indefensible. Probes take free L1 only.
        { baseUrl: ep.baseUrl, apiKey: key, model: input.model, system, messages: seed as { role: string; content: unknown }[], tools: toolSchemas, thinkingBudget: input.thinking?.budgetTokens },
        { systemNoMemory, total: promptTokens, max: contextWindow, anchored: !!anchored },
      )
      if (b) cb.onBreakdown?.(b)
    })().catch(() => {})
  }

  const loopRes = await runAgentLoop(
    {
      protocol,
      baseUrl: ep.baseUrl,
      apiKey: key,
      model: input.model,
      system,
      seed,
      cacheEnabled: ep.cacheEnabled,
      conversationId: convId,
      endpointId: input.endpointId,
      tools,
      serverTools,
      cwd: input.cwd,
      convId,
      roleId,
      runId,
      thinking: input.thinking,
      contextWindow: input.contextWindow,
      permissionMode: input.permissionMode ?? 'default',
      imageModel: input.imageModel,
      onTodosChange: cb.onTodos, // TodoWrite executed (mid-turn) → live push to the workspace Tasks panel
      // 批C2b: solo direct chat gets a CONV-LEVEL async registry (handles outlive the run) + the cross-turn park
      // hook, so launch_async + await_async can park the turn and resume when the op completes. The IPC layer
      // (agent.handler.startAgentRun) arms the session-bus delivery + drives sessionBus.markActive/markIdle around
      // this run; a completed handle injects its result into the bus (solo-async), which resumes when idle.
      asyncRegistry: getSoloAsync(convId).reg,
      parkSolo: (inflight, settledResults) => parkSolo(convId, inflight, settledResults),
    },
    cb,
    signal,
  )

  // ⑤ Persist the assistant's FINAL reply (same run_id) + any images its tools generated as attachments,
  //    so reopening the conversation shows them. Tool steps stay in the transcript only. Persist when there's
  //    text OR an attachment — a designer turn may produce only an image with no closing text. (An empty-text
  //    assistant turn is skipped from the NEXT run's seed by conversationToAgentMessages, so no Anthropic 400.)
  if (loopRes.text || loopRes.attachments.length) {
    convService.append(convId, {
      author: 'expert',
      expertId: roleId,
      model: input.model,
      content: loopRes.text,
      attachments: loopRes.attachments,
      runId,
      inputTokens: loopRes.contextTokens, // DISPLAY: current context size (last turn's prompt, NOT accumulated). usage_events below keeps the accumulated total for billing.
      cacheReadTokens: loopRes.cacheReadTokens, // cache-read share of that last turn — drives the persistent "(+N cached)" note
      outputTokens: loopRes.outTokens,
      sentTokens: loopRes.inTokens, // SETTLE ↑: cumulative billing input across the whole agent loop (total sent this turn)
    })
  }

  // Record usage — a dev-agent run spans many turns; without this it's invisible to usage stats.
  usageRepo.record({
    conversationId: convId,
    expertId: roleId,
    model: input.model,
    provider: ep.protocol,
    inTokens: loopRes.inTokens,
    outTokens: loopRes.outTokens,
  })

  // The server just priced this exact seed — keep the figure so the next turn adds to it instead of counting
  // the whole payload again. Written AFTER the loop and only on a real observation: an errored or aborted run
  // has no usage to anchor on, and a stale anchor is worse than none. `recent` ends on the user turn that
  // started this run (it was appended above, before the read) — everything after that id is the next tail.
  // Deliberately firstContext and not contextTokens: the last turn's prompt has a run's worth of tool traffic
  // in it, and that traffic never reaches the messages table, so it will not be in the next seed.
  if (loopRes.firstContext > 0 && recent.length && seedIsRecent) {
    contextAnchor.record(convId, roleId, {
      tokens: loopRes.firstContext,
      upToMsgId: recent[recent.length - 1].id,
      model: input.model,
      toolsFp,
      systemLen: system.length,
      images: countReplayImages(recent),
      coveredUpTo: summary?.coveredUpTo ?? null,
    })
  }

  // Prediction vs truth, on the one seam where both exist: promptTokens is what the counter said this run's
  // starting context would be, firstContext is what the server measured it as. Same quantity, so the gap is
  // the counter's error and nothing else. Diagnostic only — never gates anything.
  if (process.env.NSAI_TOKEN_DIAG && loopRes.firstContext > 0) {
    const err = ((promptTokens - loopRes.firstContext) / loopRes.firstContext) * 100
    console.log(
      `[token-diag] protocol=${protocol} model=${input.model} src=${anchored ? 'anchor' : gateFolded ? 'gate' : 'count'} predicted=${promptTokens} observed=${loopRes.firstContext} err=${err >= 0 ? '+' : ''}${err.toFixed(1)}% tools=${toolSchemas?.length ?? 0} peak=${loopRes.contextTokens}`,
    )
  }

  // ⑥ chat-layer side effects, fire-and-forget so they don't delay the run's completion (mirrors the
  //    plain-chat onDone path: memory extraction cadence + compression check). contextWindow is passed
  //    explicitly because the role's model may not be in the endpoint's availableModels catalog.
  //    B6/#8: chained (not concurrent) so the post-turn extraction runs BEFORE the compaction check —
  //    compaction's STEP 0 extraction otherwise races onTurn on the same CAS lock and could fold before
  //    memory is captured. Still fire-and-forget overall; the run's completion isn't delayed.
  // The gate runs AFTER the loop, so the server has already priced this conversation and there is nothing left
  // to predict: firstContext is the run's starting context as measured, and the reply just landed on top of
  // it. Their sum is the context the NEXT run opens with, which is what the gate decides on. This is the same
  // anchor + tail the read path uses, with the tail being the one message this run appended.
  // It is deliberately NOT contextTokens (the last turn's prompt): that has a run's worth of tool traffic baked
  // in, and tool traffic never reaches the messages table, so feeding the peak here would fold conversations
  // nowhere near the window. And it prices the reply by its TEXT, not by usage.outTokens: output tokens include
  // extended thinking, which is billed but never persisted — charging the gate for thinking would fold early
  // for reasons the next prompt will not contain. Rendering the text the same way the seed will is the point.
  // promptTokens stays the fallback for a run with no usable measurement — errored, aborted, or folded by the
  // loop before its first send. Until now it was the ONLY input, which is what made openai fold early:
  // roughCount prices tool schemas at chars/2, so the gate was handed a doubled prompt every single turn.
  const measuredContext =
    loopRes.firstContext > 0
      ? loopRes.firstContext + roughMessageTokens([{ type: 'text', text: loopRes.text }])
      : promptTokens
  void memoryService
    .onTurn({ convId, roleId, endpointId: input.endpointId, model: input.model })
    .catch(() => {})
    .then(() =>
      compressionService.maybeCompress({
        convId,
        roleId,
        endpointId: input.endpointId,
        model: input.model,
        contextWindow: input.contextWindow,
        currentTokens: measuredContext,
      })
    )
    .catch(() => {})

  // text + contextTokens feed the terminal step:done event — the SAME authoritative settle every dispatched
  // step gets (text mirrors the persisted row; contextTokens = the last turn's real prompt, not the up-front
  // promptTokens estimate, so live settle and reload display agree).
  return { reason: loopRes.reason, turns: loopRes.turns, convId, runId, text: loopRes.text, promptTokens, contextTokens: loopRes.contextTokens, outputTokens: loopRes.outTokens, sentTokens: loopRes.inTokens }
}

// Rebuild tool cards from a conversation's transcript, grouped by run_id. The renderer calls this when
// opening a past agent conversation — messages hold only the final reply; the tool steps live in the
// transcript. Returns {} for a non-agent conversation (no transcript file). Contract: one assistant
// message per run — solo runs, dispatched steps, and collab experts all persist exactly one row stamped
// with their runId (the drain unification), so all of a run's tools attach to that single message; a run
// whose 'run' line carries ephemeralDisplay persisted NO row and is rebuilt as a synthetic segment instead
// (openConversation). If that ever changes, the renderer needs a per-message key, not just run_id.
export function readTranscript(convId: string): Record<string, RunTranscript> {
  const file = join(dataDir(), 'sessions', convId, 'transcript.jsonl')
  if (!existsSync(file)) return {}
  let lines: string[]
  try {
    lines = readFileSync(file, 'utf-8').split('\n')
  } catch {
    return {}
  }
  return parseTranscript(lines)
}
