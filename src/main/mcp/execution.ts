import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { McpToolCallError } from './errors'
import type { ConnectedServer } from './types'

// A generous per-call ceiling — MCP tools can be long-running (builds, fetches). The agent's own abort
// signal (threaded from AgentContext) is the real cancel path.
const TOOL_TIMEOUT_MS = 120_000

export interface McpCallResult {
  content: unknown
  isError?: boolean
}

// Call a tool on a connected MCP server. `toolName` is the server-local name (NOT the mcp__ prefixed
// one). Wraps SDK failures as McpToolCallError so the service/loop can attribute them.
export async function callMcpTool(
  server: ConnectedServer,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<McpCallResult> {
  try {
    const result = await server.client.callTool({ name: toolName, arguments: args }, CallToolResultSchema, {
      signal,
      timeout: TOOL_TIMEOUT_MS
    })
    return { content: result.content, isError: result.isError === true }
  } catch (e) {
    throw new McpToolCallError(server.name, toolName, e instanceof Error ? e.message : String(e))
  }
}
