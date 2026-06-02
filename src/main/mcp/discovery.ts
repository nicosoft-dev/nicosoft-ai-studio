import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { buildTool, type Tool } from '../agent/tool'
import type { ToolResultBlock } from '../agent/types'
import { buildMcpToolName } from './strings'
import { callMcpTool, type McpCallResult } from './execution'
import type { ConnectedServer } from './types'

const MAX_DESC = 2048

// Fetch tools/list from a connected server and wrap each as a studio Tool:
//   - name        = mcp__<server>__<tool> (buildMcpToolName)
//   - inputJSONSchema = the MCP tool's JSON Schema, declared to the model verbatim (loop.ts prefers it)
//   - inputSchema = permissive zod passthrough so execution.ts:runOne's safeParse accepts any object
//   - gates       from MCP annotations (readOnlyHint / destructiveHint)
//   - shouldDefer = true (large/optional sets surface via tool_search, not up-front context)
//   - call()      round-trips to the server via callMcpTool, threading the agent's abort signal
//   - checkPermissions defaults to allow (buildTool) — the MCP server is user-configured + trusted
export async function discoverTools(server: ConnectedServer): Promise<Tool[]> {
  if (!server.capabilities?.tools) return []
  const result = await server.client.request({ method: 'tools/list' }, ListToolsResultSchema)
  return result.tools.map((t): Tool => {
    const desc = t.description ?? ''
    const prompt = desc.length > MAX_DESC ? desc.slice(0, MAX_DESC) + '… [truncated]' : desc
    const readOnly = t.annotations?.readOnlyHint === true
    return buildTool({
      name: buildMcpToolName(server.name, t.name),
      inputSchema: z.record(z.string(), z.unknown()),
      inputJSONSchema: t.inputSchema as Record<string, unknown>,
      prompt: () => prompt,
      isReadOnly: () => readOnly,
      isConcurrencySafe: () => readOnly,
      isDestructive: () => t.annotations?.destructiveHint === true,
      shouldDefer: true,
      async call(input, ctx) {
        const out = await callMcpTool(server, t.name, input as Record<string, unknown>, ctx.signal)
        return { data: out }
      },
      mapResult(out: McpCallResult, toolUseId): ToolResultBlock {
        const content = typeof out.content === 'string' ? out.content : JSON.stringify(out.content)
        return {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          ...(out.isError ? { is_error: true } : {})
        }
      }
    }) as unknown as Tool
  })
}
