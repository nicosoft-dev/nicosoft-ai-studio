// Verify the analyst (Turing) — an agent-loop role that is NOT a dev role (core tools only: Bash/Write/etc,
// no service/lsp/sub-agent). Real data-analysis task with numerically checkable answers: compute mean,
// population std, least-squares trend slope, and average MoM growth over a revenue series, write them to
// result.json, and report. We recompute independently and assert the agent's numbers match — proving a
// non-dev agent role uses core tools to do real quantitative work correctly.
//   node e2e/verify-analyst.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/analyst-test'
rmSync(CWD, { recursive: true, force: true })
mkdirSync(CWD, { recursive: true })

const DATA = [120, 135, 128, 142, 155, 168, 162, 175, 188, 195, 210, 225]
const n = DATA.length
const mean = DATA.reduce((a, b) => a + b, 0) / n
const std = Math.sqrt(DATA.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
const xs = DATA.map((_, i) => i + 1)
const mx = xs.reduce((a, b) => a + b, 0) / n
const slope = xs.reduce((a, x, i) => a + (x - mx) * (DATA[i] - mean), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0)
const growths = DATA.slice(1).map((y, i) => y / DATA[i] - 1)
const avgGrowth = growths.reduce((a, b) => a + b, 0) / growths.length
const expected = { mean, std, slope, avgGrowth }

const events = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stdout?.on('data', (d) => { for (const line of d.toString().split('\n')) { const m = line.match(/\[agent-event\] (.+)$/); if (m) { try { events.push(JSON.parse(m[1])) } catch { /**/ } } } })
app.process().stderr?.on('data', () => {})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async (cwd) => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'analyst')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false, why: 'analyst (Turing) not bound to a keyed endpoint — bind it in Settings first' }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'analyst')) await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ analyst: cwd }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ analyst: 'bypass' }))
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'analyst' }))
  return { ok: true, model: b.model, thinkingDepth: b.thinkingDepth }
}, CWD)
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP —', setup.why); await app.close(); process.exit(0) }

await page.reload()
await page.waitForTimeout(1500)
const prompt = [
  'Monthly revenue (in thousands) for a year: [120, 135, 128, 142, 155, 168, 162, 175, 188, 195, 210, 225].',
  'Compute PRECISELY using a tool (Bash with python or awk — do not eyeball):',
  '- mean',
  '- population standard deviation (divide by N, not N-1)',
  '- linear trend slope: least-squares fit of revenue vs month index 1..12',
  '- average month-over-month growth rate (mean of consecutive ratios minus 1)',
  'Write the four results as JSON to a file named result.json in your working directory, with numeric keys: mean, std, slope, avgGrowth. Then report the four values.',
].join('\n')
await page.fill('textarea.cmp-textarea', prompt)
await page.waitForTimeout(200)
await page.keyboard.press('Enter')

let ended = false
for (let i = 0; i < 90; i++) {
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

const close = (a, b) => typeof a === 'number' && Math.abs(a - b) <= Math.max(0.02 * Math.abs(b), 0.05)
console.log('\n===== ANALYST (Turing) VERIFY =====')
console.log('ended:', ended, '| model:', setup.model, '| thinking:', setup.thinkingDepth)
console.log('expected:', JSON.stringify(Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, +v.toFixed(4)]))))
console.log('got     :', JSON.stringify(got))
console.log('tools:', JSON.stringify(tools))
const fails = []
if (!ended) fails.push('analyst did not reach session:end')
if (!usedTool) fails.push('no Bash/Write/code_execution — analyst did not actually compute with a tool')
if (!got) fails.push('result.json missing or unparseable')
else for (const k of ['mean', 'std', 'slope', 'avgGrowth']) if (!close(got[k], expected[k])) fails.push(`${k}: got ${got[k]}, expected ≈ ${expected[k].toFixed(4)}`)
console.log(fails.length ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ') : '\n✓ PASS — analyst used core tools to compute all four stats correctly (independently verified)')
process.exit(fails.length ? 1 : 0)
