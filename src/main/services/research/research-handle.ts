// createResearchHandle — the agent-tool bridge for studio_research (research-role-driven-redesign §4.1), the
// sibling of createLensHandle. Where the lens handle wraps a code-review fan-out, this wraps the deep-research
// fan-out (runResearchScript, REUSED verbatim). It:
//   1. emits a TOP-LEVEL 'StudioResearch' progress card rooted at a sentinel parent → the renderer orphan-appends
//      it as a top-level tool → the Tasks panel collects it (exactly how the lens panel card reaches Tasks);
//   2. drives that card's phase children off the script's onPhase/onLog (research sub-agents are quiet/card-only
//      by design, so we surface the SCRIPT's phase progress — Scope → Search → Fetch → Verify → Synthesize —
//      NOT per-sub-agent bubbles, matching agent-research.ts's contract);
//   3. runs the fan-out under the CALLER role's endpoint (makeLensDeps(opts) inside runResearchScript binds the
//      caller's runRoleStep), so research runs on the driving role's native protocol — pickResearchRole is gone.
// Returns the formatted cited report (ok) or a clear failure reason (never a silent empty result).
import { ulid } from '../../db/id'
import { runResearchScript } from './agent-research'
import { formatReport } from './report'
import type { ResearchHandle, StudioResearchResult, PermissionMode, PermissionRequest, PermissionDecision } from '../../agent/context'
import type { RunStepOptions } from '../coordinator/step'
import type { CoordinatorCallbacks } from '../coordinator/types'
import type { AgentLlmEvent } from '../../agent/llm/anthropic'

// A parent id that matches NO top-level tool → the renderer orphan-appends the card as a TOP-LEVEL tool (the same
// mechanism the lens panel card uses; applySubToolStart falls back to a top-level push when the parent matches
// nothing, and anchors to the caller's message by roleId). The card is distinguished by its name
// ('StudioResearch'), not this value — reusing the shared orphan sentinel is intentional and safe.
const RESEARCH_PANEL_ROOT = 'coordinator-gate-b'

export interface ResearchHandleDeps {
  convId: string
  callerRoleId: string
  cwd: string
  permissionMode: PermissionMode
  signal: AbortSignal
  onStream: (e: AgentLlmEvent) => void
  requestPermission: (req: PermissionRequest, signal?: AbortSignal) => Promise<PermissionDecision>
}

export function createResearchHandle(deps: ResearchHandleDeps): ResearchHandle {
  return {
    async run(input): Promise<StudioResearchResult> {
      const question = (input.question ?? '').trim()
      if (!question) return { ok: false, message: 'studio_research needs a question — pass `question`.' }
      // Abort on EITHER the run/session signal OR the per-handle async signal (Tasks-panel Stop → AsyncRegistry.stop),
      // exactly like createLensHandle. The sync (non-async) path passes no signal → deps.signal alone.
      const runSignal = input.signal ? AbortSignal.any([deps.signal, input.signal]) : deps.signal

      const panelId = ulid()
      const emit = deps.onStream
      // Open the top-level StudioResearch card. asyncHandleId lets the Tasks Stop button abort THIS handle (it flows
      // to the ToolCall's input.asyncHandleId, which the research card's Stop button reads).
      emit({ type: 'sub_tool_start', parentToolId: RESEARCH_PANEL_ROOT, toolUseId: panelId, name: 'StudioResearch', input: { question, asyncHandleId: input.asyncHandleId } })

      // Phase children: each onPhase opens a new child row + closes the previous; onLog updates the current child's
      // live summary. Gives the card a phase-by-phase tree — the research analogue of the lens reviewer rows.
      let phaseId: string | null = null
      let phaseTitle = ''
      const onPhase = (title: string): void => {
        if (phaseId) emit({ type: 'sub_tool_done', parentToolId: panelId, toolUseId: phaseId, name: phaseTitle, isError: false })
        phaseId = ulid()
        phaseTitle = title
        emit({ type: 'sub_tool_start', parentToolId: panelId, toolUseId: phaseId, name: title, input: { phase: title } })
      }
      const onLog = (message: string): void => {
        if (phaseId) emit({ type: 'sub_tool_progress', parentToolId: panelId, toolUseId: phaseId, tool: phaseTitle, summary: message.slice(0, 200) })
      }

      // The research fan-out is QUIET (card-only): its sub-agents' tool events are intentionally NOT surfaced as
      // loose bubbles (agent-research.ts). So the shim is a no-op sink except for permission (WebSearch/WebFetch are
      // auto-approved read-only, but thread it for parity). Progress is the phase children above, driven by onPhase/onLog.
      const shim: CoordinatorCallbacks = {
        onDispatch: () => {},
        onStepStart: () => {},
        onDelta: () => {},
        onStepDone: () => {},
        onExpertActive: () => {},
        onToolEvent: () => {},
        onToolImage: () => {},
        requestPermission: (_roleId, req, sig) => deps.requestPermission(req, sig),
      }
      const opts: RunStepOptions = {
        convId: deps.convId,
        roleId: deps.callerRoleId,
        prompt: '',
        dispatch: [deps.callerRoleId, 'studio_research'],
        cb: shim,
        signal: runSignal,
        cwd: deps.cwd,
        permissionMode: deps.permissionMode,
      }

      // Always close the phase child + panel card, even on an unexpected throw (executor-level) — otherwise the
      // Tasks card would be stuck "running" forever. The AsyncRegistry settler still marks the handle failed on rethrow.
      const closeCard = (isError: boolean, result: string): void => {
        if (phaseId) emit({ type: 'sub_tool_done', parentToolId: panelId, toolUseId: phaseId, name: phaseTitle, isError })
        emit({ type: 'sub_tool_done', parentToolId: RESEARCH_PANEL_ROOT, toolUseId: panelId, name: 'StudioResearch', isError, result })
      }
      let result: Awaited<ReturnType<typeof runResearchScript>>
      try {
        result = await runResearchScript({ opts, roleId: deps.callerRoleId, question, onPhase, onLog })
      } catch (e) {
        closeCard(true, 'failed')
        throw e
      }
      closeCard(!result.ok, result.ok ? 'report ready' : 'failed')
      if (!result.ok) return { ok: false, message: `The research run failed: ${result.error ?? 'unknown error'}` }
      const report = formatReport(result.value)
      return { ok: true, message: report || '(the research run produced no report)' }
    },
  }
}
