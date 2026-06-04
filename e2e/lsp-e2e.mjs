// Runtime verify for the lsp tool (batch 4). Seeds a tiny real TS project (cross-file definition: main.ts
// calls greet() defined in lib.ts; plus bad.ts with a type error), then tells engineer to use lsp
// definition / references / diagnostics and report. We assert the tool fired and that the language server's
// real answers reach the reply: greet is defined in lib.ts, and bad.ts's type error is surfaced. Proves the
// full chain: tool -> LSPManager -> typescript-language-server (stdio LSP) -> structured result -> agent.
//   node e2e/lsp-e2e.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/lsp-e2e-proj'
rmSync(CWD, { recursive: true, force: true })
mkdirSync(CWD, { recursive: true })
writeFileSync(join(CWD, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', noEmit: true } }))
writeFileSync(join(CWD, 'lib.ts'), `export function greet(name: string): string {\n  return 'hi ' + name\n}\n`)
writeFileSync(join(CWD, 'main.ts'), `import { greet } from './lib'\n\nconst who = 'world'\nconsole.log(greet(who))\n`)
writeFileSync(join(CWD, 'bad.ts'), `const count: number = 'not a number'\nexport default count\n`)

const events = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stdout?.on('data', (d) => { for (const line of d.toString().split('\n')) { const m = line.match(/\[agent-event\] (.+)$/); if (m) { try { events.push(JSON.parse(m[1])) } catch { /* partial */ } } } })
app.process().stderr?.on('data', () => {})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async (cwd) => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'engineer')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false, why: 'engineer not bound to a keyed endpoint' }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'engineer')) await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ engineer: cwd }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ engineer: 'bypass' }))
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'engineer' }))
  return { ok: true, thinkingDepth: b.thinkingDepth, model: b.model }
}, CWD)
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP —', setup.why); await app.close(); process.exit(0) }

await page.reload()
await page.waitForTimeout(1500)
const prompt = [
  'Use the lsp tool for ALL of this (do not guess from reading the files), then report in plain text:',
  '1. In main.ts the function greet is called. Use lsp definition on that call to find which FILE greet is defined in.',
  '2. Use lsp references on greet to count how many locations reference it.',
  '3. Use lsp diagnostics on bad.ts and report its error message.',
  'Final answer on separate lines: "defined-in: <filename>", "references: <count>", "bad.ts-error: <message>".',
].join('\n')
await page.fill('textarea.cmp-textarea', prompt)
await page.waitForTimeout(200)
await page.keyboard.press('Enter')

// LSP server cold-start (tsserver load + project analysis) is slow on the first query; allow time.
let finished = false
for (let i = 0; i < 70; i++) {
  await page.waitForTimeout(2000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
  if (!(await page.$('.cmp-stop')) && i > 2) { finished = true; break }
}
await page.waitForTimeout(800)

const reply = await page.evaluate(async () => {
  const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === 'engineer')
  if (!c) return ''
  return (await window.api.conversations.messages(c.id)).filter((m) => m.author !== 'user').map((m) => m.content).join('\n')
})
const usedLsp = events.some((e) => e.type === 'tool:pre' && e.tool === 'lsp')
await app.close()
rmSync(CWD, { recursive: true, force: true })
const lower = (reply || '').toLowerCase()
const hasDef = /lib\.ts/i.test(reply || '')
const hasDiag = /assignable|not a number|'number'|type 'string'/i.test(reply || '')
console.log('usedLsp:', usedLsp, '| finished:', finished, '| hasDef(lib.ts):', hasDef, '| hasDiag:', hasDiag)
console.log('reply:', JSON.stringify((reply || '').slice(0, 280)))
const fails = []
if (!usedLsp) fails.push('engineer did not call the lsp tool')
if (!hasDef) fails.push('reply does not say greet is defined in lib.ts — definition may not have resolved')
if (!hasDiag) fails.push("reply does not surface bad.ts's type error — diagnostics may not have flowed back")
console.log(fails.length ? '✗ FAIL:\n  - ' + fails.join('\n  - ') : '✓ PASS — lsp resolved greet→lib.ts and surfaced bad.ts type error via typescript-language-server')
process.exit(fails.length ? 1 : 0)
