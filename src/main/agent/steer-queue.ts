// steer-queue.ts — mid-turn steering (docs/mid-turn-steering-design.md): user messages sent while a run
// is still streaming, keyed by (convId, lane) where lane = the TARGET role's id. agent:steer persists the
// message FIRST (it is a real user turn the moment it hits the transcript) and enqueues it here; the agent
// loop drains ITS OWN lane at every request-assembly edge and folds the batch into its in-memory messages
// (CC 2.x fold semantics — the in-flight request is never aborted), and the consumer's terminal (solo run's
// finally / a collab expert's turn end) drains leftovers so nothing strands.
//
// The lane matters because a collab conversation runs SEVERAL loops on ONE convId (each expert, ctx.roleId
// apart) — a convId-only queue would let whichever expert reaches its request edge first swallow a message
// addressed to a teammate. Solo is the single-lane case (lane = the conversation's role).
//
// Deliberately NOT session-bus: the bus wraps every note in the "[SYSTEM NOTIFICATION — NOT USER INPUT]"
// shell, which is the exact opposite of what these are — real user input the model must treat as such.
import type { AgentMessage } from './types'

export interface SteerMessage {
  text: string
  msgId: string // the already-persisted conversation row id (agent:steer persists before enqueueing)
}

const queues = new Map<string, SteerMessage[]>()
// NUL separator: no convId (ulid) or roleId can contain it, so distinct (convId, lane) pairs can never
// concatenate to the same key.
const laneKey = (convId: string, lane: string): string => convId + '\u0000' + lane

export const steerQueue = {
  enqueue(convId: string, lane: string, msg: SteerMessage): void {
    const k = laneKey(convId, lane)
    const q = queues.get(k)
    if (q) q.push(msg)
    else queues.set(k, [msg])
  },
  // Atomic take-all (one tick of the single-threaded main process): the caller owns the returned batch; an
  // enqueue after this call lands in a fresh queue for the next drain point. The lane's terminal consumer
  // (solo finally / collab turn end) is LAST — anything it drains either continues into a fresh turn or is
  // discarded from the queue only (the rows stay persisted and ride the next run's history), so no message
  // is ever lost or double-read.
  drain(convId: string, lane: string): SteerMessage[] {
    const k = laneKey(convId, lane)
    const q = queues.get(k)
    if (!q || q.length === 0) return []
    queues.delete(k)
    return q
  },
}

// ── Mid-collab context for the closeout (P1) ────────────────────────────────────────────────────────────
// What the user said WHILE a collaboration ran must reach the coordinator's closeout — the synthesis and
// the independent final audit judge "did the team deliver what was asked", and without these sections a
// user-steered stop reads as a phantom order that "was never in your instructions" (observed live: honest
// work called abandoned). Pure string builders, pinned by e2e/steer.mts — the synthesize call rides the
// tool-less llmChat layer that no wire log covers, so the contract lives here, not in a dogfood assertion.

// The synthesis-prompt section: spliced between the original question and the expert panel.
export function midCollabSection(messages: string[]): string[] {
  if (!messages.length) return []
  return [
    '',
    'While the team worked, the user sent additional MID-COLLABORATION instructions (each expert already received them live). Where they conflict with the original ask, the LATEST instruction defines what "done" means:',
    ...messages.flatMap((m) => ['', `> ${m.replace(/\n/g, '\n> ')}`]),
  ]
}

// The boundary-continuation flavor: a message the user sent DURING a turn that had no request edge to fold
// into (Danny routing / dispatching) runs as the next turn — but the router only sees a fresh prompt over a
// history whose dominant thread is the job that just ran, and re-dispatches that whole job again (observed
// live: a "by the way…" follow-up re-ran the entire task). State the timing so it is read as a follow-up.
// In-memory only: the raw text is what agent:steer persisted, and the transcript must keep the user's words.
export function queuedContinuationPrompt(messages: string[]): string {
  const body = messages.join('\n\n')
  return (
    '[Timing note from the system: the user sent this WHILE your previous turn was still running, so you ' +
    'had not read it yet; that turn has since finished and its result is in the conversation above. Answer ' +
    'it as a follow-up in that context — start or dispatch new work only if the message actually asks for ' +
    'it, and never redo the work that just completed.]\n\n' +
    body
  )
}

// The audit flavor: the verifier's "original prompt" extended with the user's mid-collab updates, so a
// legitimately steered stop is judged against the user's latest word instead of failing the audit.
export function withMidCollabInstructions(prompt: string, messages: string[]): string {
  if (!messages.length) return prompt
  return `${prompt}\n\n[The user sent these additional instructions MID-COLLABORATION — where they conflict with the ask above, the LATEST instruction defines what "done" means:]\n${messages.map((m) => `- ${m}`).join('\n')}`
}

// Fold one steered user text into the loop's in-memory messages. Mid-loop the trailing message is usually
// the user-role tool_results turn — append a text block to it rather than pushing a second consecutive
// user message (some upstreams 400 on non-alternating roles; same discipline as agent.service's
// resumeNote fold). A '\n\n' separator is added only between adjacent text blocks so prose can't run
// together; after a tool_result block the new text stands on its own.
export function foldUserText(messages: AgentMessage[], text: string): AgentMessage[] {
  const last = messages[messages.length - 1]
  if (last && last.role === 'user') {
    const lastBlock = last.content[last.content.length - 1]
    const sep = lastBlock && lastBlock.type === 'text' ? '\n\n' : ''
    return [...messages.slice(0, -1), { ...last, content: [...last.content, { type: 'text', text: sep + text }] }]
  }
  return [...messages, { role: 'user', content: [{ type: 'text', text }] }]
}
