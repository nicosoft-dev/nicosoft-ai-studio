// The agent loop: while(true) → call model with tools → if the assistant emitted tool_use blocks,
// execute them and feed tool_results back as a user message, then loop; otherwise done. Continuation
// is decided by "did the assistant request a tool", NOT stop_reason. See §2.1 + §D.

import { z } from 'zod'
import { LlmError } from '../llm/types'
import {
  autocompact,
  autocompactThreshold,
  type CompactConfig,
  estimateTokens,
  microcompact,
  SYSTEM_PROMPT_RESERVE,
  tokensFromUsage,
} from './compact'
import type { AgentContext } from './context'
import { runTools } from './execution'
import { callWithTools, type AgentLlmEvent } from './llm'
import type { Tool } from './tool'
import type { AgentMessage, AssistantTurn, ToolSchema, ToolUseBlock, Usage } from './types'

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
  contextWindow?: number // model's context window, drives the autocompact threshold (default 200K)
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

const SUBAGENT_SYSTEM =
  'You are a sub-agent spawned to complete a focused subtask. Use the tools to do it, then give a ' +
  'concise summary of what you found or did as your final message — that summary is all the parent sees.'

// Sub-agents get a lower turn cap than the parent to bound the fan-out blast radius (a runaway child
// can't burn the parent's full budget).
const SUBAGENT_MAX_TURNS = 20

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
  const contextWindow = params.contextWindow ?? 200_000
  let messages: AgentMessage[] = [...params.messages] // let — compaction replaces it
  const toolSchemas = tools.map(toToolSchema)
  let turns = 0
  // Compaction (layers 2/3) state: the full context size billed at the last API turn + where that
  // was, so the running estimate = tokensFromUsage(lastUsage) + char/4 of messages added since.
  let lastUsage: Usage | undefined
  let lastUsageAt = 0
  const compactConfig: CompactConfig = { baseUrl, apiKey, model, signal: ctx.signal }
  const threshold = autocompactThreshold(contextWindow)
  let reactiveCompacted = false // bounce guard: if a send overflows right after a reactive compact, fail

  // The context tools run in, augmented with the Task-tool sub-agent spawner: an isolated inner loop
  // with the same LLM config but no Task tool (recursion bounded to one level) and a fresh
  // readFileState/todos, sharing cwd / signal / permission with the parent. Inside a sub-agent
  // ctx.spawnSubAgent is already undefined (and Task is filtered out), so this no-ops there.
  const subAgentTools = tools.filter((t) => t.name !== 'Task')
  const execCtx: AgentContext = {
    ...ctx,
    spawnSubAgent: async ({ prompt }) => {
      const sub = runAgent({
        baseUrl,
        apiKey,
        model,
        system: SUBAGENT_SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        tools: subAgentTools,
        ctx: { ...ctx, readFileState: new Map(), todos: [], spawnSubAgent: undefined },
        maxTokens,
        maxTurns: Math.min(maxTurns, SUBAGENT_MAX_TURNS),
      })
      let last = ''
      let result: AgentResult | undefined
      for (;;) {
        const step = await sub.next()
        if (step.done) {
          result = step.value
          break
        }
        if (step.value.type === 'assistant') {
          for (const b of step.value.message.content) if (b.type === 'text') last = b.text
        }
      }
      // Annotate a non-complete termination so a truncated child can't masquerade as a full summary.
      if (result?.reason === 'max_turns') {
        return `${last ? `${last}\n\n` : ''}(Note: sub-agent stopped at its turn limit; result may be incomplete.)`
      }
      if (result?.reason === 'aborted') {
        return `${last ? `${last}\n\n` : ''}(Note: sub-agent was aborted before completing.)`
      }
      return last
    },
  }

  while (true) {
    // Layer 2: microcompact every turn (clear old tool-result content, keep the recent 5) — cheap,
    // structure-preserving, runs before the expensive autocompact so it can keep it from firing.
    const mc = microcompact(messages)
    messages = mc.messages
    // Layer 3: autocompact when the running estimate crosses the threshold. The estimate subtracts the
    // chars microcompact just freed (still counted inside lastUsage.inTokens until the next real send)
    // and adds a fixed reserve for the gateway-injected system prompt estimateTokens can't see — but
    // ONLY once lastUsage anchors the estimate: on turn 1 there's nothing to under-count, and adding it
    // could spuriously trip a small-window threshold on an empty conversation.
    const estimate =
      (lastUsage ? tokensFromUsage(lastUsage) + SYSTEM_PROMPT_RESERVE : 0) +
      estimateTokens(messages.slice(lastUsageAt)) -
      Math.ceil(mc.freedChars / 4)
    if (estimate > threshold) {
      const compacted = await autocompact(messages, compactConfig)
      if (compacted !== messages) {
        messages = compacted
        lastUsage = undefined
        lastUsageAt = 0
      }
    }

    let assistant: AssistantTurn
    try {
      assistant = await callWithTools(
        { baseUrl, apiKey, model, system, messages, tools: toolSchemas, maxTokens, signal: ctx.signal },
        params.onStream,
      )
      reactiveCompacted = false // a successful send clears the bounce guard
    } catch (err) {
      // Reactive compaction: an overflow status (400/413) that slipped past the proactive check →
      // compact once and retry. Gate on STATUS + a "haven't already compacted for this send" guard,
      // NOT on the error message (a proxy may reshape it). If it overflows again right after a reactive
      // compact, fail cleanly instead of looping.
      const overflow = err instanceof LlmError && (err.status === 400 || err.status === 413)
      if (overflow && !reactiveCompacted) {
        const compacted = await autocompact(messages, compactConfig)
        if (compacted !== messages) {
          messages = compacted
          lastUsage = undefined
          lastUsageAt = 0
          reactiveCompacted = true
          continue
        }
      }
      throw err
    }
    // Anthropic rejects an empty-content assistant message — if the turn produced nothing usable,
    // end rather than push it (which would 400 the next request).
    if (assistant.content.length === 0) return { reason: 'completed', messages, turns }

    const assistantMsg: AgentMessage = { role: 'assistant', content: assistant.content }
    messages.push(assistantMsg)
    lastUsage = assistant.usage
    lastUsageAt = messages.length // after the assistant push → slice(lastUsageAt) = tool_results below
    yield { type: 'assistant', message: assistantMsg, usage: assistant.usage }

    // Loop continues iff the assistant requested ≥1 tool — NOT based on stop_reason (§2.1).
    const toolUses = assistant.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0) return { reason: 'completed', messages, turns }

    // Append tool_results immediately after the assistant turn — keeps tool_use/tool_result pairing
    // valid by construction. (A real mid-crash repair pass — ensurePairing — lands in H2.) Push and
    // yield the SAME object so a future ensurePairing rewrite stays consistent across both views.
    const results = await runTools(toolUses, tools, execCtx)
    const userMsg: AgentMessage = { role: 'user', content: results }
    messages.push(userMsg)
    yield { type: 'tool_results', message: userMsg }

    turns += 1
    if (ctx.signal.aborted) return { reason: 'aborted', messages, turns }
    if (turns >= maxTurns) return { reason: 'max_turns', messages, turns }
  }
}
