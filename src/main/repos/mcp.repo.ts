import { ulid } from '../db/id'
import { getDb } from '../db/connection'
import type { McpScope, McpStatus, McpTransport } from '../ipc/contracts'

// mcp_servers CRUD. Pure SQL — no business logic / keychain. env (stdio) / headers (http) are SECRETS
// and live in the OS keychain (mcp.service), never this table. args/scope are JSON columns; enabled 0/1.

export interface McpServerRow {
  id: string
  name: string
  transport: McpTransport
  endpointOrCmd: string
  args: string[]
  scope: McpScope
  enabled: boolean
  toolCount: number
  status: McpStatus
  createdAt: string
}

export interface McpServerCreateInput {
  name: string
  transport: McpTransport
  endpointOrCmd: string
  args?: string[]
  scope?: McpScope
  enabled?: boolean
}

export interface McpServerUpdatePatch {
  name?: string
  transport?: McpTransport
  endpointOrCmd?: string
  args?: string[]
  scope?: McpScope
  enabled?: boolean
  toolCount?: number
  status?: McpStatus
}

interface McpServerRaw {
  id: string
  name: string
  transport: McpTransport
  endpoint_or_cmd: string
  args: string
  scope: string
  enabled: number
  tool_count: number
  status: McpStatus
  created_at: string
}

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

function mapRow(raw: McpServerRaw): McpServerRow {
  return {
    id: raw.id,
    name: raw.name,
    transport: raw.transport,
    endpointOrCmd: raw.endpoint_or_cmd,
    args: parseJson<string[]>(raw.args, []),
    scope: parseJson<McpScope>(raw.scope, 'all'),
    enabled: raw.enabled === 1,
    toolCount: raw.tool_count,
    status: raw.status,
    createdAt: raw.created_at
  }
}

export function list(): McpServerRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC')
    .all() as unknown as McpServerRaw[]
  return rows.map(mapRow)
}

export function getById(id: string): McpServerRow | null {
  const row = getDb().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as unknown as
    | McpServerRaw
    | undefined
  return row ? mapRow(row) : null
}

export function create(input: McpServerCreateInput): McpServerRow {
  const id = ulid()
  const createdAt = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO mcp_servers (id, name, transport, endpoint_or_cmd, args, scope, enabled, tool_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'idle', ?)`
    )
    .run(
      id,
      input.name,
      input.transport,
      input.endpointOrCmd,
      JSON.stringify(input.args ?? []),
      JSON.stringify(input.scope ?? 'all'),
      (input.enabled ?? true) ? 1 : 0,
      createdAt
    )
  return getById(id) as McpServerRow
}

export function update(id: string, patch: McpServerUpdatePatch): McpServerRow | null {
  const sets: string[] = []
  const args: (string | number)[] = []
  if (patch.name !== undefined) {
    sets.push('name = ?')
    args.push(patch.name)
  }
  if (patch.transport !== undefined) {
    sets.push('transport = ?')
    args.push(patch.transport)
  }
  if (patch.endpointOrCmd !== undefined) {
    sets.push('endpoint_or_cmd = ?')
    args.push(patch.endpointOrCmd)
  }
  if (patch.args !== undefined) {
    sets.push('args = ?')
    args.push(JSON.stringify(patch.args))
  }
  if (patch.scope !== undefined) {
    sets.push('scope = ?')
    args.push(JSON.stringify(patch.scope))
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?')
    args.push(patch.enabled ? 1 : 0)
  }
  if (patch.toolCount !== undefined) {
    sets.push('tool_count = ?')
    args.push(patch.toolCount)
  }
  if (patch.status !== undefined) {
    sets.push('status = ?')
    args.push(patch.status)
  }
  if (sets.length > 0) {
    args.push(id)
    getDb()
      .prepare(`UPDATE mcp_servers SET ${sets.join(', ')} WHERE id = ?`)
      .run(...args)
  }
  return getById(id)
}

export function remove(id: string): void {
  getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
}
