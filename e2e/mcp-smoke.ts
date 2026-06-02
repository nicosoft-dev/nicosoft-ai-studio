// Stage-A smoke: connect to a REAL stdio MCP server (@modelcontextprotocol/server-filesystem via npx),
// discover its tools through the official SDK, and confirm toolsForRole surfaces them. Proves the
// transport + connection + discovery + manager chain works end to end. Run: npx tsx e2e/mcp-smoke.ts
import { McpManager } from '../src/main/mcp/manager'

async function main(): Promise<void> {
  const m = new McpManager()
  try {
    const { toolCount } = await m.connect(
      'smoke',
      'filesystem',
      { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
      'all'
    )
    console.log('✓ connected — toolCount:', toolCount)
    if (toolCount === 0) throw new Error('no tools discovered')

    const tools = m.toolsForRole('engineer')
    console.log('✓ toolsForRole(engineer):', tools.map((t) => t.name).join(', '))
    if (tools.length !== toolCount) throw new Error('scope=all should expose all tools to every role')

    const sample = tools[0]
    console.log('✓ sample:', sample.name, '| inputJSONSchema:', !!sample.inputJSONSchema, '| deferred:', sample.shouldDefer)
    if (!sample.name.startsWith('mcp__filesystem__')) throw new Error('bad tool name prefix')
    if (!sample.inputJSONSchema) throw new Error('MCP tool must carry inputJSONSchema')

    console.log('✓ MCP stage-A smoke passed')
  } finally {
    await m.disconnectAll()
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error('✗', e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
