// Tool execution engine: a per-tool pipeline (schema-validate → value-validate → permission → call →
// serialize) wrapped by a concurrency scheduler (partition contiguous same-safety blocks; read-only
// batches run in parallel, writes serialize). Every tool_use yields exactly one tool_result with the
// same id — the invariant that keeps the conversation valid. See §2.3 + §B.

import type { ZodError } from 'zod'
import type { AgentContext } from './context'
import { findTool, type Tool } from './tool'
import { persistLargeResult } from './tool-result-storage'
import type { ToolResultBlock, ToolUseBlock } from './types'

const MAX_CONCURRENCY = 10

// Errors never go through a tool's mapResult — the engine builds the is_error block directly.
function errorResult(toolUseId: string, message: string): ToolResultBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: `<tool_use_error>${message}</tool_use_error>`,
    is_error: true,
  }
}

// Compact zod issues into one line (the raw error.message is a bulky JSON array that burns tokens).
function formatZodError(error: ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

// Resolve a tool's checkPermissions into allow/deny, consulting permissionMode + the UI callback.
async function checkPermission(
  tool: Tool,
  input: Record<string, unknown>,
  ctx: AgentContext,
): Promise<{ allow: boolean; message?: string; updatedInput?: Record<string, unknown> }> {
  if (ctx.permissionMode === 'bypass') return { allow: true }
  if (ctx.permissionMode === 'plan' && !tool.isReadOnly(input)) {
    return { allow: false, message: 'In plan mode — mutations are not allowed. Present a plan instead.' }
  }

  const result = await tool.checkPermissions(input, ctx)
  if (result.behavior === 'allow') return { allow: true, updatedInput: result.updatedInput }
  if (result.behavior === 'deny') return { allow: false, message: result.message }

  // 'ask': read-only tools auto-allow; otherwise prompt the user via the approval hook.
  if (tool.isReadOnly(input)) return { allow: true }
  const decision = await ctx.requestPermission({ toolName: tool.name, input, reason: result.message })
  return {
    allow: decision.allow,
    updatedInput: decision.updatedInput,
    message: decision.allow ? undefined : 'User denied permission',
  }
}

// Run one tool_use through the full pipeline. Always resolves to exactly one tool_result.
async function runOne(
  toolUse: ToolUseBlock,
  tools: readonly Tool[],
  ctx: AgentContext,
): Promise<ToolResultBlock> {
  const tool = findTool(tools, toolUse.name)
  if (!tool) return errorResult(toolUse.id, `No such tool available: ${toolUse.name}`)
  if (ctx.signal.aborted) return errorResult(toolUse.id, 'Tool execution cancelled')

  // 1. schema validation (Zod) — the model frequently emits invalid input. safeParse never throws.
  const parsed = tool.inputSchema.safeParse(toolUse.input)
  if (!parsed.success) return errorResult(toolUse.id, `InputValidationError: ${formatZodError(parsed.error)}`)
  const input = parsed.data as Record<string, unknown>

  // 2-4. Value-validation → permission → execute → serialize, ALL wrapped: a throw anywhere — a
  // tool's validateInput, the permission hook rejecting (e.g. the UI IPC channel dropped / user
  // closed the dialog), or call itself — must still yield exactly one tool_result, or the dangling
  // tool_use wedges the conversation (§3.5).
  try {
    const valid = await tool.validateInput(input, ctx)
    if (!valid.result) return errorResult(toolUse.id, valid.message)

    const decision = await checkPermission(tool, input, ctx)
    if (!decision.allow) return errorResult(toolUse.id, decision.message ?? 'Permission denied')

    const result = await tool.call(decision.updatedInput ?? input, ctx)
    const block = tool.mapResult(result.data, toolUse.id)
    return await persistLargeResult(block, tool.maxResultSizeChars, ctx.sessionDir)
  } catch (err) {
    return errorResult(toolUse.id, err instanceof Error ? err.message : String(err))
  }
}

// Partition into maximal contiguous runs of the same concurrency-safety, preserving order. A throw
// in isConcurrencySafe (or unparsable input) is treated as unsafe — conservative.
function partition(
  toolUses: ToolUseBlock[],
  tools: readonly Tool[],
): Array<{ safe: boolean; items: ToolUseBlock[] }> {
  const groups: Array<{ safe: boolean; items: ToolUseBlock[] }> = []
  for (const tu of toolUses) {
    const tool = findTool(tools, tu.name)
    let safe = false
    try {
      const parsed = tool?.inputSchema.safeParse(tu.input)
      safe = tool != null && parsed?.success === true && tool.isConcurrencySafe(parsed.data)
    } catch {
      safe = false
    }
    const last = groups[groups.length - 1]
    if (last && last.safe === safe) last.items.push(tu)
    else groups.push({ safe, items: [tu] })
  }
  return groups
}

// Map over items with a concurrency cap, preserving input order in the output.
async function mapWithCap<T, R>(items: T[], cap: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, () => worker()))
  return results
}

// Execute all tool_use blocks → tool_result blocks in original order. Read-only batches run in
// parallel (cap 10); writes serialize.
export async function runTools(
  toolUses: ToolUseBlock[],
  tools: readonly Tool[],
  ctx: AgentContext,
): Promise<ToolResultBlock[]> {
  const out: ToolResultBlock[] = []
  for (const group of partition(toolUses, tools)) {
    if (group.safe && group.items.length > 1) {
      out.push(...(await mapWithCap(group.items, MAX_CONCURRENCY, (tu) => runOne(tu, tools, ctx))))
    } else {
      for (const tu of group.items) out.push(await runOne(tu, tools, ctx))
    }
  }
  return out
}
