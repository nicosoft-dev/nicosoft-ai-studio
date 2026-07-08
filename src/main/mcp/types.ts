import { z } from 'zod'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

// MCP server config — discriminated union by transport. stdio runs a local subprocess; http talks to a
// remote StreamableHTTP endpoint. (SSE / WebSocket / InProcess are intentionally omitted — single-user
// desktop only needs these two; see docs/nicosoft-studio Batch 6.)
export const McpStdioConfig = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  // Spawn dir. Set for materialized local-folder servers (extensions/mcp/<id>/) so relative paths in
  // command/args resolve inside Studio's own copy instead of wherever the app process started.
  cwd: z.string().optional()
})
export const McpHttpConfig = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional()
})
export const McpServerConfigSchema = z.discriminatedUnion('type', [McpStdioConfig, McpHttpConfig])
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>

// Which roles see a server's tools: 'all', or an explicit list of role ids.
export type McpScope = 'all' | string[]

// A live connection to a server, plus a cleanup that closes the client (and tears down a stdio child).
export interface ConnectedServer {
  id: string
  name: string
  client: Client
  capabilities: Record<string, unknown>
  cleanup: () => Promise<void>
}
