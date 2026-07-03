// Launch review (§7.5 — "whoever launches, checks"): a /workflow command in a role's conversation does
// NOT start the run directly. The conversation's role runs one visible turn that (a) relays the
// mechanical preflight verdict, (b) reviews the script + params itself, and (c) submits the decision
// through the per-run closure tool below — the ONLY path that actually starts the run (machine protocol
// rides a tool call, never prose — G10). No decision tool call = nothing runs: the review IS the gate,
// and a block is absolute (the user fixes and re-issues the command).
//
// The closure tool exists ONLY for this one turn (agent.service opts.extraTools) — roles have no
// standing workflow-launch tool, so a role can never start a workflow on its own initiative.

import { z } from 'zod'
import { buildTool, type Tool } from '../../agent/tool'
import * as convService from '../conversation.service'
import * as workflowService from './service'
import type { AgentContext } from '../../agent/context'
import type { WorkflowDto, WorkflowRunEvent } from '../../ipc/contracts'

export interface LaunchReviewRequest {
  workflow: WorkflowDto
  params: Record<string, string | number | boolean>
  roleId: string // the reviewing/launching role (the conversation's role) — recorded as the run's initiator
  convId: string // the chat conversation the command was issued in (origin + launch-card home)
  mechanicalIssue: string | null // preflight verdict, resolved by the caller BEFORE the turn starts
  onCard: (messageId: string, payload: string) => void // live-push the persisted launch-card row
  onRunEvent: (ev: WorkflowRunEvent) => void // mirror run events onto the shared broadcast
}

// The review turn's instruction note (rides opts.resumeNote — no synthetic user bubble). Carries
// everything the role needs to judge WITHOUT tools: the full script, the declared params with the
// provided/default fill-in, and the mechanical verdict.
export function buildLaunchNote(req: LaunchReviewRequest): string {
  const w = req.workflow
  const paramLines = w.params.length
    ? w.params
        .map((p) => {
          const provided = req.params[p.name]
          const value = provided !== undefined ? JSON.stringify(provided) : p.default !== undefined ? `${JSON.stringify(p.default)} (default)` : 'MISSING — no value and no default'
          return `- ${p.name} (${p.type}): ${value}`
        })
        .join('\n')
    : '(none declared)'
  const parts = [
    `The user asked to run the saved workflow \`${w.name}\` — ${w.description || 'no description'}. You are the launch gate: review it, then submit your decision with the workflow_launch_decision tool (exactly once). NEVER print the decision as text or JSON.`,
    `Run parameters:\n${paramLines}`,
    `The workflow script:\n\`\`\`\n${w.script}\n\`\`\``,
  ]
  if (req.mechanicalIssue) {
    parts.push(
      `Mechanical preflight FAILED: ${req.mechanicalIssue}\nThis is blocking — tell the user what is wrong in your own words and submit {"decision":"block"} with the issues. Do NOT launch (the tool refuses a failed preflight anyway).`
    )
  } else {
    parts.push(
      'Mechanical preflight passed (script parses, security scan green, step roles bound, folder params exist). Now review it YOURSELF: do the parameters make sense for this script? Does anything in the steps look wrong or unsafe for what the user asked? If you find real problems, tell the user and submit {"decision":"block"} with the issues. Otherwise submit {"decision":"launch"} — the tool starts the run, waits for it, and returns the outcome; relay that outcome to the user in your own words.'
    )
  }
  return parts.join('\n\n')
}

// The decision channel + launch executor. `decision:"launch"` runs the workflow INSIDE the tool call
// (trigger='command', initiator = the reviewing role): the launch card lands the moment the run row
// exists, the settle outcome returns as the tool result, and aborting the chat turn stops the run
// (the Danny-branch pattern). isReadOnly=true on purpose: the side effect IS the user's explicit
// /workflow command — the permission classifier must not stack a second approval on it.
export function makeLaunchDecisionTool(req: LaunchReviewRequest): Tool {
  let submitted = false
  return buildTool({
    name: 'workflow_launch_decision',
    prompt: () =>
      'Submit your FINAL launch decision for the requested workflow run (exactly once, after your review). launch = start the run and await its outcome; block = refuse with the problems found. The decision is machine-read from this call — never print it in your reply.',
    inputSchema: z.object({
      decision: z.enum(['launch', 'block']),
      issues: z.array(z.string()).optional().describe('block: the concrete problems found (shown to the user)'),
    }),
    isReadOnly: () => true,
    isConcurrencySafe: () => false,
    call: async (input: { decision: 'launch' | 'block'; issues?: string[] }, ctx: AgentContext) => {
      if (submitted) return { data: 'A decision was already submitted for this launch — do not submit again.' }
      submitted = true
      if (input.decision === 'block') {
        return { data: 'Block recorded — nothing was started. Report the problems to the user in your own words.' }
      }
      let launchedRunId: string | null = null
      const onAbort = (): void => {
        if (launchedRunId) void workflowService.stop(launchedRunId)
      }
      ctx.signal.addEventListener('abort', onAbort, { once: true })
      try {
        const res = await workflowService.runAndWait(
          req.workflow.id,
          req.params,
          'command',
          req.onRunEvent,
          ({ runId }) => {
            launchedRunId = runId
            const payload = JSON.stringify({ v: 1, workflowId: req.workflow.id, runId, name: req.workflow.name, params: req.params })
            const row = convService.append(req.convId, { author: 'expert', content: payload, segmentKind: 'workflow-launch' })
            req.onCard(row.id, payload)
          },
          { initiator: req.roleId, convId: req.convId }
        )
        if (res.status === 'ok') {
          return { data: `The run completed (ok). Script return text:\n${res.resultText.trim() || '(empty — the script returned nothing)'}\n\nRelay the outcome to the user in your own words.` }
        }
        return { data: `The run ${res.status}${res.failDetail ? ` — ${res.failDetail}` : ''}. The run panel has the full record. Tell the user honestly.` }
      } catch (e) {
        // preflight refusal (state changed since the note) or an infra fault — surface it, never crash the turn
        return { data: `The run could not start: ${e instanceof Error ? e.message : String(e)}. Tell the user.` }
      } finally {
        ctx.signal.removeEventListener('abort', onAbort)
      }
    },
    mapResult: (out: unknown, toolUseId: string) => ({ type: 'tool_result', tool_use_id: toolUseId, content: String(out) }),
  }) as unknown as Tool
}
