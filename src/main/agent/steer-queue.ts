// steer-queue.ts — mid-turn steering (docs/mid-turn-steering-design.md): user messages sent while a solo
// run is still streaming, keyed by convId. agent:steer persists the message FIRST (it is a real user turn
// the moment it hits the transcript) and enqueues it here; the agent loop drains at every request-assembly
// edge and folds the batch into its in-memory messages (CC 2.x fold semantics — the in-flight request is
// never aborted), and the run's finally drains leftovers to auto-continue as a fresh turn (R4).
//
// Deliberately NOT session-bus: the bus wraps every note in the "[SYSTEM NOTIFICATION — NOT USER INPUT]"
// shell, which is the exact opposite of what these are — real user input the model must treat as such.
import type { AgentMessage } from './types'

export interface SteerMessage {
  text: string
  msgId: string // the already-persisted conversation row id (agent:steer persists before enqueueing)
}

const queues = new Map<string, SteerMessage[]>()

export const steerQueue = {
  enqueue(convId: string, msg: SteerMessage): void {
    const q = queues.get(convId)
    if (q) q.push(msg)
    else queues.set(convId, [msg])
  },
  // Atomic take-all (one tick of the single-threaded main process): the caller owns the returned batch; an
  // enqueue after this call lands in a fresh queue for the next drain point. The run's finally is the LAST
  // consumer — anything it drains either auto-continues (clean finish) or is discarded from the queue only
  // (the rows stay persisted and ride the next run's history), so no message is ever lost or double-read.
  drain(convId: string): SteerMessage[] {
    const q = queues.get(convId)
    if (!q || q.length === 0) return []
    queues.delete(convId)
    return q
  },
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
