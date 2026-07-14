// createDesignHandle — the agent-tool bridge for studio_design (research-role-driven-redesign §4.1), the sibling
// of createResearchHandle / createLensHandle. It wraps the design-panel fan-out (runDesignScript, REUSED verbatim):
//   1. emits a TOP-LEVEL 'StudioDesign' progress card rooted at the sentinel parent → the renderer orphan-appends
//      it as a top-level tool → the Tasks panel collects it (exactly like the lens/research panel card);
//   2. drives that card's phase children off the script's onPhase/onLog (the sub-agents are quiet/card-only, so we
//      surface the SCRIPT's phase progress — the judge panel's Attempt → Judge → Synthesize — NOT per-agent bubbles);
//   3. runs the fan-out under the CALLER role's endpoint (makeLensDeps(opts) inside runDesignScript), so design
//      runs on the driving role's native protocol — pickDesignRole is gone.
// Returns the formatted design synthesis (ok) or a clear failure reason (never a silent empty result).
import { ulid } from '../../db/id'
import { runDesignScript } from './agent-design'
import { formatDesign } from './report'
import type { DesignHandle, StudioDesignResult, PermissionMode, PermissionRequest, PermissionDecision } from '../../agent/context'
import type { RunStepOptions } from '../coordinator/step'
import type { CoordinatorCallbacks } from '../coordinator/types'
import type { AgentLlmEvent } from '../../agent/llm/anthropic'

// A parent id that matches NO top-level tool → the renderer orphan-appends the card as a TOP-LEVEL tool (same
// mechanism as the lens/research panel card; anchored to the caller's message by roleId). The card is
// distinguished by its name ('StudioDesign'), not this value — reusing the shared orphan sentinel is safe.
const DESIGN_PANEL_ROOT = 'coordinator-gate-b'

export interface DesignHandleDeps {
  convId: string
  callerRoleId: string
  cwd: string
  permissionMode: PermissionMode
  signal: AbortSignal
  onStream: (e: AgentLlmEvent) => void
  requestPermission: (req: PermissionRequest, signal?: AbortSignal) => Promise<PermissionDecision>
}

export function createDesignHandle(deps: DesignHandleDeps): DesignHandle {
  return {
    async run(input): Promise<StudioDesignResult> {
      const problem = (input.problem ?? '').trim()
      if (!problem) return { ok: false, message: 'studio_design needs a problem statement — pass `problem`.' }
      // Abort on EITHER the run/session signal OR the per-handle async signal (Tasks-panel Stop → AsyncRegistry.stop).
      const runSignal = input.signal ? AbortSignal.any([deps.signal, input.signal]) : deps.signal

      const panelId = ulid()
      const emit = deps.onStream
      // Open the top-level StudioDesign card. asyncHandleId lets the Tasks Stop button abort THIS handle.
      emit({ type: 'sub_tool_start', parentToolId: DESIGN_PANEL_ROOT, toolUseId: panelId, name: 'StudioDesign', input: { problem, asyncHandleId: input.asyncHandleId } })

      // Phase children: each onPhase opens a new child + closes the previous; onLog updates the current child's summary.
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

      // The design fan-out is QUIET (card-only): its sub-agents' tool events are NOT surfaced as loose bubbles.
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
        dispatch: [deps.callerRoleId, 'studio_design'],
        cb: shim,
        signal: runSignal,
        cwd: deps.cwd,
        permissionMode: deps.permissionMode,
      }

      // Always close the phase child + panel card, even on an unexpected throw (executor-level) — else the Tasks
      // card would be stuck "running". The AsyncRegistry settler still marks the handle failed on rethrow.
      const closeCard = (isError: boolean, result: string): void => {
        if (phaseId) emit({ type: 'sub_tool_done', parentToolId: panelId, toolUseId: phaseId, name: phaseTitle, isError })
        emit({ type: 'sub_tool_done', parentToolId: DESIGN_PANEL_ROOT, toolUseId: panelId, name: 'StudioDesign', isError, result })
      }
      let result: Awaited<ReturnType<typeof runDesignScript>>
      try {
        result = await runDesignScript({ opts, roleId: deps.callerRoleId, problem, onPhase, onLog })
      } catch (e) {
        closeCard(true, 'failed')
        throw e
      }
      closeCard(!result.ok, result.ok ? 'synthesis ready' : 'failed')
      if (!result.ok) return { ok: false, message: `The design run failed: ${result.error ?? 'unknown error'}` }
      const report = formatDesign(result.value)
      return { ok: true, message: report || '(the design run produced no synthesis)' }
    },
  }
}
