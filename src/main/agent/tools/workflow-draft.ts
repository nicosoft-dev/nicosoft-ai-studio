// workflow_draft — assisted workflow authoring (docs/workflow-assisted-authoring-design.md §4): the user
// describes a need in chat, the role drafts a COMPLETE workflow script and submits it here. The service
// gates it (security scan → parse/shape → role validity → name clash → visible-conversation guard); a
// rejected draft bounces back as the tool result for the model to fix — the user never sees a bad draft.
// A passing draft lands a persisted CARD row (segmentKind='workflow-draft') with a read-only flow diagram
// derived from lint(script).nodes; NOTHING exists in the workflows table until the user clicks confirm on
// the card (workflows:createFromDraft). G10: the script rides this tool call + the card payload only —
// it never appears in the model's prose or the tool result. Every agent role (built-in + custom) carries
// the tool; Danny's direct chat surface does not (the dispatched role drafts), and sub-agents are
// stripped in loop.ts — the card is a conversation-level decision surface.

import { z } from 'zod'
import { buildTool } from '../tool'
import type { AgentContext } from '../context'
import type { ToolResultBlock } from '../types'
import * as workflowService from '../../services/workflow/service'
import { displayName } from '../roles/prompts'

function textResult(toolUseId: string, text: string, isError = false): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: toolUseId, content: text, is_error: isError }
}

const draftSchema = z.object({
  script: z
    .string()
    .describe('the COMPLETE workflow script (meta + body) — full text every call, revisions included. It is linted before the card appears; fix and resubmit on errors.'),
  supersedes: z
    .string()
    .optional()
    .describe('when revising an earlier draft in this conversation, the draftId from that call\'s result — the old card grays out and this one replaces it'),
})

// The roster is DYNAMIC (assisted authoring §4.3): exactly the ids the lint accepts right now — enabled,
// endpoint-bound agent roles, custom ones included. Custom ids are 26-char ulids; the copy-verbatim rule
// exists because a paraphrased/truncated ulid is the known failure mode (the unknown-role gate bounces it).
function rosterLines(): string {
  const ids = [...workflowService.validStepRoles()]
  if (ids.length === 0) return '(no roles are currently available as step executors)'
  return ids.map((id) => `- ${displayName(id)} (${id})`).join('\n')
}

export const workflowDraftTool = buildTool({
  name: 'workflow_draft',
  inputSchema: draftSchema,
  prompt: () =>
    'Draft a workflow for the user and present it as an in-chat confirmation card (name, params, and a ' +
    'flow diagram derived from your script). NOTHING is created until the user confirms on the card — ' +
    'never announce the workflow as created, and never print the script in your reply (the card shows ' +
    'the diagram). Use this when the user asks to build/create a workflow; for revisions, submit the ' +
    'full rewritten script with `supersedes` set to the previous draftId.\n' +
    '\n' +
    'Script format (a plain JS module):\n' +
    "  export const meta = { name: '<kebab-case-slug>', description: '<one line>', nsw: 1, params: [{ name: 'x', type: 'string', default: '…' }] }\n" +
    "  // optional: cwd: '<absolute working folder>' in meta; param types: string | number | boolean | folder\n" +
    '  then one statement per step (the body reads declared params via the `args` global — args.x, never `params`):\n' +
    "  phase('Research')                                              — group the following steps in the diagram\n" +
    "  const a = await agent(`analyze ${args.x}`, { role: 'analyst' }) — one expert step; role MUST be a literal\n" +
    "  const [b, c] = await parallel([() => agent(`…`, { role: 'engineer' }), () => agent(`…`, { role: 'turing' })])\n" +
    '  log(`progress note`)\n' +
    '  return a                                                       — the return text is the run\'s result\n' +
    '\n' +
    'Available step roles — copy the id in (…) EXACTLY as written, character for character (custom-role ' +
    'ids are 26-char codes; a retyped or shortened id is rejected as an unknown role):\n' +
    rosterLines(),
  isReadOnly: () => true, // app-DB-only card row (distill/remember precedent) — the CREATE is the user's click
  isConcurrencySafe: () => false, // supersede chains must land in order
  call: async (input, ctx: AgentContext) => {
    if (!ctx.roleId) return { data: { ok: false as const, error: 'workflow_draft is unavailable here (this run carries no role identity).' } }
    if (!ctx.convId) return { data: { ok: false as const, error: 'drafting needs a visible conversation — no one can confirm a card here.' } }
    try {
      const outcome = workflowService.draftCard({
        script: input.script,
        supersedes: input.supersedes,
        roleId: ctx.roleId,
        convId: ctx.convId,
      })
      if (!outcome.ok) return { data: outcome }
      // G10: hand the model status + the anchors it may need (draftId for a later supersede) — never the script.
      return {
        data: {
          ok: true as const,
          draftId: (JSON.parse(outcome.message.content) as { draftId: string }).draftId,
          name: outcome.name,
          steps: outcome.steps,
          phases: outcome.phases,
          roles: outcome.roles,
          update: outcome.update,
        },
      }
    } catch (e) {
      return { data: { ok: false as const, error: e instanceof Error ? e.message : String(e) } }
    }
  },
  mapResult: (out: { ok: true; draftId: string; name: string; steps: number; phases: number; roles: string[]; update: boolean } | { ok: false; error: string }, toolUseId) => {
    if (!out.ok) return textResult(toolUseId, out.error, true)
    const chain = out.roles.map(displayName).join(' → ') || '—'
    return textResult(
      toolUseId,
      `Draft card presented: "${out.name}" (draftId ${out.draftId}) — ${out.steps} step${out.steps === 1 ? '' : 's'}` +
        `${out.phases ? ` / ${out.phases} phase${out.phases === 1 ? '' : 's'}` : ''}, roles: ${chain}.` +
        (out.update ? ` Confirming will UPDATE the workflow "${out.name}" this conversation created earlier.` : '') +
        ' Waiting for the user to confirm on the card — do NOT create or save it yourself, and do NOT re-draft unless the user asks for changes.',
    )
  },
})
