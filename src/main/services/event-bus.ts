// Internal agent lifecycle event bus (optimization C). A typed, in-process publish/subscribe so studio's
// OWN features (audit log, notifications, future capabilities) can observe agent runs — WITHOUT exposing
// user-configurable hooks (a deliberate scope choice for the desktop product; see docs 21). This is an
// internal seam, not an IPC or user-facing surface. Emit is best-effort: a throwing subscriber can never
// break the agent run or starve the other subscribers.

export type AgentLifecycleEvent =
  | { type: 'session:start'; convId: string; roleId: string; ts: number }
  | { type: 'session:end'; convId: string; roleId: string; turns: number; reason: string; ts: number }
  | { type: 'tool:pre'; convId: string; roleId: string; tool: string; ts: number }
  | { type: 'tool:post'; convId: string; roleId: string; tool: string; isError: boolean; ts: number }
  | { type: 'compact:pre'; convId: string; roleId: string; ts: number }
  | { type: 'compact:post'; convId: string; roleId: string; ts: number }

type Handler = (event: AgentLifecycleEvent) => void

class AgentEventBus {
  private handlers = new Set<Handler>()

  // Subscribe; returns an unsubscribe fn.
  on(handler: Handler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  emit(event: AgentLifecycleEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event)
      } catch {
        /* a subscriber must never break the run or block the next subscriber */
      }
    }
  }
}

export const agentEvents = new AgentEventBus()

// First built-in subscriber: a structured audit line per lifecycle event. Proves the bus end-to-end and
// gives ops a trace of what each expert did. Future features subscribe the same way.
agentEvents.on((event) => {
  console.log('[agent-event] ' + JSON.stringify(event))
})
