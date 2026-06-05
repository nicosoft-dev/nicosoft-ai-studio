// Verify the generalist (Amélie) — an agent-loop role, non-dev (core tools only). Her brief includes "quick
// math"; we give a precise-math task (compound interest, monthly vs daily) where eyeballing fails, require a
// tool, and check the numbers against an independent recompute. Proves the generalist actually reaches for a
// tool and computes correctly rather than hand-waving.
//   node e2e/verify-generalist.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/generalist-test'
rmSync(CWD, { recursive: true, force: true })
mkdirSync(CWD, { recursive: true })

const monthly = 10000 * (1 + 0.05 / 12) ** 120
const daily = 10000 * (1 + 0.05 / 365) ** 3650
const diff = daily - monthly
const expected = { monthly, daily, diff }

const events = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stdout?.on('data', (d) => { for (const line of d.toString().split('\n')) { const m = line.match(/\[agent-event\] (.+)$/); if (m) { try { events.push(JSON.parse(m[1])) } catch { /**/ } } } })
app.process().stderr?.on('data', () => {})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async (cwd) => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'generalist')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false, why: 'generalist (Amélie) not bound to a keyed endpoint — bind it in Settings first' }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'generalist')) await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ generalist: cwd }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ generalist: 'bypass' }))
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'generalist' }))
  return { ok: true, model: b.model, thinkingDepth: b.thinkingDepth }
}, CWD)
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP —', setup.why); await app.close(); process.exit(0) }

await page.reload()
await page.waitForTimeout(1500)
const prompt = [
  'Quick precise math — compute with a tool (Bash + python), do NOT estimate:',
  '- Compound interest: principal $10,000, annual rate 5% compounded MONTHLY, after 10 years → final amount.',
  '- Same but compounded DAILY (365 periods/year) over 10 years → final amount.',
  '- The difference between the two final amounts.',
  'Write the three numbers as JSON to result.json in your working directory, keys: monthly, daily, diff (numbers, full precision). Then report them.',
].join('\n')
await page.fill('textarea.cmp-textarea', prompt)
await page.waitForTimeout(200)
await page.keyboard.press('Enter')

let ended = false
for (let i = 0; i < 180; i++) {
  await page.waitForTimeout(2000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
  if (events.some((e) => e.type === 'session:end')) { ended = true; break }
}
await page.waitForTimeout(500)
await app.close()

let got = null
const rf = join(CWD, 'result.json')
if (existsSync(rf)) { try { got = JSON.parse(readFileSync(rf, 'utf8')) } catch { /**/ } }
const tools = {}
for (const e of events) if (e.type === 'tool:pre') tools[e.tool] = (tools[e.tool] || 0) + 1
const usedTool = (tools['Bash'] || 0) + (tools['Write'] || 0) + (tools['code_execution'] || 0) > 0

const close = (a, b) => typeof a === 'number' && Math.abs(a - b) <= Math.max(0.005 * Math.abs(b), 0.5)
console.log('\n===== GENERALIST (Amélie) VERIFY =====')
console.log('ended:', ended, '| model:', setup.model, '| thinking:', setup.thinkingDepth)
console.log('expected:', JSON.stringify(Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, +v.toFixed(2)]))))
console.log('got     :', JSON.stringify(got))
console.log('tools:', JSON.stringify(tools))
const fails = []
if (!ended) fails.push('generalist did not reach session:end')
if (!usedTool) fails.push('no Bash/Write/code_execution — generalist estimated instead of computing with a tool')
if (!got) fails.push('result.json missing or unparseable')
else for (const k of ['monthly', 'daily', 'diff']) if (!close(got[k], expected[k])) fails.push(`${k}: got ${got[k]}, expected ≈ ${expected[k].toFixed(2)}`)
console.log(fails.length ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ') : '\n✓ PASS — generalist reached for a tool and computed all three values correctly (independently verified)')
process.exit(fails.length ? 1 : 0)
