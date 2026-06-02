// Stage-A verify for plugins: parse a real plugin directory (plugin.json + skills/ + mcpServers +
// roles) and assert manifest parsing + skills discovery + validation (missing manifest, bad JSON, no
// components, missing name). The install/uninstall orchestration is covered by the stage-B electron
// e2e (needs a real DB). No Electron. Run: npx tsx e2e/plugin-smoke.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strict as assert } from 'node:assert'
import { parsePlugin } from '../src/main/plugins/manifest'

function makePlugin(dir: string, manifest: object, skills: string[] = []): string {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2))
  for (const s of skills) {
    mkdirSync(join(dir, 'skills', s), { recursive: true })
    writeFileSync(join(dir, 'skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: ${s} skill\n---\nDo ${s}.`)
  }
  return dir
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'nsai-plugin-'))
  try {
    // 1) Full plugin: skills + mcpServers + roles.
    const dir = makePlugin(
      join(root, 'plug'),
      {
        name: 'dev-pack', version: '1.2.0', description: 'Dev tools', author: 'nico',
        mcpServers: { github: { command: 'npx', args: ['-y', 'gh-mcp'], env: { TOKEN: 'x' } } },
        roles: [{ name: 'Reviewer', systemPrompt: 'Review code.', color: 'var(--accent)' }]
      },
      ['code-review', 'pdf']
    )
    const p = parsePlugin(dir)
    console.log('parsed:', JSON.stringify({
      name: p.manifest.name, version: p.manifest.version,
      skills: p.skills.map((s) => s.name).sort(),
      mcp: Object.keys(p.manifest.mcpServers ?? {}),
      roles: p.manifest.roles?.map((r) => r.name)
    }))
    assert.equal(p.manifest.name, 'dev-pack')
    assert.equal(p.manifest.version, '1.2.0')
    assert.deepEqual(p.skills.map((s) => s.name).sort(), ['code-review', 'pdf'])
    assert.ok(p.skills.every((s) => s.dirPath.includes('skills/')), 'skill dirPaths point at the folders')
    assert.deepEqual(Object.keys(p.manifest.mcpServers ?? {}), ['github'])
    assert.equal(p.manifest.roles?.[0].name, 'Reviewer')
    console.log('✓ full plugin parsed (skills + mcpServers + roles)')

    // 2) plugin.json at the root (not under .claude-plugin/).
    const root2 = join(root, 'p2')
    mkdirSync(join(root2, 'skills', 'x'), { recursive: true })
    writeFileSync(join(root2, 'plugin.json'), JSON.stringify({ name: 'p2' }))
    writeFileSync(join(root2, 'skills', 'x', 'SKILL.md'), '---\nname: x\ndescription: d\n---\nbody')
    const p2 = parsePlugin(root2)
    assert.equal(p2.manifest.name, 'p2')
    assert.equal(p2.skills.length, 1)
    console.log('✓ root-level plugin.json + skills/ discovery')

    // 3) bad cases.
    const noManifest = join(root, 'none'); mkdirSync(noManifest)
    assert.throws(() => parsePlugin(noManifest), /No plugin\.json/, 'missing manifest rejected')

    const badJson = join(root, 'bad'); mkdirSync(badJson)
    writeFileSync(join(badJson, 'plugin.json'), '{ not json')
    assert.throws(() => parsePlugin(badJson), /not valid JSON/, 'bad JSON rejected')

    const empty = join(root, 'empty'); mkdirSync(empty)
    writeFileSync(join(empty, 'plugin.json'), JSON.stringify({ name: 'empty-plugin' }))
    assert.throws(() => parsePlugin(empty), /no components/i, 'plugin with no components rejected')

    const noName = join(root, 'noname'); mkdirSync(noName)
    writeFileSync(join(noName, 'plugin.json'), JSON.stringify({ description: 'x', roles: [{ name: 'R' }] }))
    assert.throws(() => parsePlugin(noName), /invalid/i, 'missing name rejected')
    console.log('✓ bad cases rejected (no manifest / bad JSON / no components / no name)')

    console.log('\n✓ ALL plugin stage-A checks passed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('✗', e instanceof Error ? e.stack : e)
    process.exit(1)
  })
