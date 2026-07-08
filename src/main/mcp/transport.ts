import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { checkUrlSsrf } from '../agent/tools/ssrf'
import { McpConnectionError } from './errors'
import type { McpServerConfig } from './types'

// Build the SDK transport for a server config.
//   stdio → spawn a subprocess. env = the SDK's safe default environment (PATH/HOME/… only, never the
//           full parent env) merged with the user's configured env, so secrets in process.env don't leak
//           into the child. stderr piped so connection.ts can surface launch failures.
//   http  → StreamableHTTP. The URL is validated through the SAME SSRF guard as channel base URLs
//           (rejects private/loopback/link-local + DNS-rebind targets) before we ever connect.
export async function buildTransport(name: string, config: McpServerConfig): Promise<Transport> {
  if (config.type === 'stdio') {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
      cwd: config.cwd,
      stderr: 'pipe'
    })
  }
  const reason = await checkUrlSsrf(config.url)
  if (reason) throw new McpConnectionError(name, `blocked URL: ${reason}`)
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined
  })
}
