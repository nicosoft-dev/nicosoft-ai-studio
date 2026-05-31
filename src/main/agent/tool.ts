// Tool contract for the Hex coding agent — the runtime-only subset of Claude Code's Tool interface
// (none of the ~30 UI render methods). A tool author writes a ToolDef; buildTool fills fail-closed
// defaults. See docs/nicosoft-studio/12-hex-coding-agent.md §2.2.

import type { z } from 'zod'
import type { AgentContext } from './context'
import type { ToolResultBlock } from './types'

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }
  | { behavior: 'ask'; message?: string }

export type ValidationResult = { result: true } | { result: false; message: string }

export interface ToolResult<Out = unknown> {
  data: Out
}

// Streaming progress (e.g. bash stdout chunks). Optional, UI-facing — the loop ignores it.
export type OnToolProgress = (progress: unknown) => void

// What a tool author writes. The four gates are optional (buildTool defaults them); call + mapResult
// are required — they do the work and serialize the result into a tool_result block.
export interface ToolDef<In extends z.ZodTypeAny = z.ZodTypeAny, Out = unknown> {
  name: string
  prompt(): string
  inputSchema: In
  isReadOnly?(input: z.infer<In>): boolean
  isConcurrencySafe?(input: z.infer<In>): boolean
  isDestructive?(input: z.infer<In>): boolean
  validateInput?(input: z.infer<In>, ctx: AgentContext): Promise<ValidationResult>
  checkPermissions?(input: z.infer<In>, ctx: AgentContext): Promise<PermissionResult>
  call(input: z.infer<In>, ctx: AgentContext, onProgress?: OnToolProgress): Promise<ToolResult<Out>>
  mapResult(out: Out, toolUseId: string): ToolResultBlock
}

// A complete tool after defaults are applied — every gate is guaranteed present.
export interface Tool<In extends z.ZodTypeAny = z.ZodTypeAny, Out = unknown>
  extends ToolDef<In, Out> {
  isReadOnly(input: z.infer<In>): boolean
  isConcurrencySafe(input: z.infer<In>): boolean
  isDestructive(input: z.infer<In>): boolean
  validateInput(input: z.infer<In>, ctx: AgentContext): Promise<ValidationResult>
  checkPermissions(input: z.infer<In>, ctx: AgentContext): Promise<PermissionResult>
}

// Fail-closed defaults: not concurrency-safe, treated as a write, non-destructive, input valid,
// allow (the permission MODE — not this default — is what actually gates writes). Mirrors ccb's
// TOOL_DEFAULTS.
export function buildTool<In extends z.ZodTypeAny, Out>(def: ToolDef<In, Out>): Tool<In, Out> {
  return {
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    isDestructive: () => false,
    validateInput: async () => ({ result: true }),
    checkPermissions: async (input: z.infer<In>) => ({
      behavior: 'allow',
      updatedInput: input as Record<string, unknown>,
    }),
    ...def,
  }
}

// Find a tool by name from a list.
export function findTool(tools: readonly Tool[], name: string): Tool | undefined {
  return tools.find((t) => t.name === name)
}
