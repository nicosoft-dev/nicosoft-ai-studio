// The agent loop: while(true) → call model with tools → if the assistant emitted tool_use blocks,
// execute them and feed tool_results back as a user message, then loop; otherwise done. Continuation
// is decided by "did the assistant request a tool", NOT stop_reason. See §2.1 + §D.

import { z } from 'zod'
import type { AgentContext } from './context'
import { runTools } from './execution'
import { callWithTools, type AgentLlmEvent } from './llm'
import type { Tool } from './tool'
import type { AgentMessage, AssistantTurn, ToolSchema, ToolUseBlock } from './types'

export interface RunAgentParams {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  messages: AgentMessage[] // seed (usually a single user message)
  tools: readonly Tool[]
  ctx: AgentContext
  maxTokens?: number
  maxTurns?: number
  onStream?: (e: AgentLlmEvent) => void // forwarded straight from the LLM call (text + tool deltas)
}

export type AgentEvent =
  | { type: 'assistant'; message: AgentMessage; usage: AssistantTurn['usage'] }
  | { type: 'tool_results'; message: AgentMessage }

export interface AgentResult {
  reason: 'completed' | 'max_turns' | 'aborted'
  messages: AgentMessage[]
  turns: number
}

// Convert a Tool's zod inputSchema into the Anthropic tools param entry.
function toToolSchema(tool: Tool): ToolSchema {
  return {
    name: tool.name,
    description: tool.prompt(),
    input_schema: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>,
  }
}

export async function* runAgent(
  params: RunAgentParams,
): AsyncGenerator<AgentEvent, AgentResult, void> {
  const { baseUrl, apiKey, model, system, tools, ctx } = params
  const maxTokens = params.maxTokens ?? 8192
  const maxTurns = params.maxTurns ?? 50
  const messages: AgentMessage[] = [...params.messages]
  const toolSchemas = tools.map(toToolSchema)
  let turns = 0

  while (true) {
    const assistant = await callWithTools(
      { baseUrl, apiKey, model, system, messages, tools: toolSchemas, maxTokens, signal: ctx.signal },
      params.onStream,
    )
    // Anthropic rejects an empty-content assistant message — if the turn produced nothing usable,
    // end rather than push it (which would 400 the next request).
    if (assistant.content.length === 0) return { reason: 'completed', messages, turns }

    const assistantMsg: AgentMessage = { role: 'assistant', content: assistant.content }
    messages.push(assistantMsg)
    yield { type: 'assistant', message: assistantMsg, usage: assistant.usage }

    // Loop continues iff the assistant requested ≥1 tool — NOT based on stop_reason (§2.1).
    const toolUses = assistant.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0) return { reason: 'completed', messages, turns }

    // Append tool_results immediately after the assistant turn — keeps tool_use/tool_result pairing
    // valid by construction. (A real mid-crash repair pass — ensurePairing — lands in H2.) Push and
    // yield the SAME object so a future ensurePairing rewrite stays consistent across both views.
    const results = await runTools(toolUses, tools, ctx)
    const userMsg: AgentMessage = { role: 'user', content: results }
    messages.push(userMsg)
    yield { type: 'tool_results', message: userMsg }

    turns += 1
    if (ctx.signal.aborted) return { reason: 'aborted', messages, turns }
    if (turns >= maxTurns) return { reason: 'max_turns', messages, turns }
  }
}
