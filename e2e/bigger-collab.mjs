// LARGER acceptance run — coordinator COLLABORATE (Flynn backend + Shuri frontend), after the optimization
// 1-3 fixes. Same Trading Strategy Backtesting Engine. Verifies [1]: the collab no longer quiesces early —
// experts keep working until their COMPLETE part is done, so the project finishes (vs the 68s early-stop
// before). bypass mode (no approval stalls). Captures project status + file tree (collab experts don't go
// through runAgentLoop, so no [agent-event] audit for them — that's a separate known gap).
//   node e2e/bigger-collab.mjs
import { _electron } from 'playwright'
import { existsSync, rmSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/backtester-collab'
const REPORT = '/tmp/bigger-collab.json'
rmSync(CWD, { recursive: true, force: true })
mkdirSync(CWD, { recursive: true })

const TASK = [
  'Build a Trading Strategy Backtesting Engine — a real, research-grade project, frontend/backend',
  'SEPARATED. Work together and agree the API contract via the consult tools.',
  '',
  'Backend (Flynn → backend/): Node.js + Express REST API —',
  '- synthetic OHLC price series via geometric Brownian motion (configurable drift/vol/seed, deterministic)',
  '- strategies as pure functions: SMA crossover, RSI mean-reversion, MACD, momentum',
  '- a backtest engine: simulate trades (sizing + commission), equity curve, trade list, and metrics',
  '  (total return, CAGR, Sharpe, max drawdown, win rate, profit factor) + a buy-and-hold baseline',
  '- a REAL Jest suite: metrics match hand-computed values, strategies emit expected signals,',
  '  buy-and-hold matches a hand-computed return, engine deterministic for a fixed seed',
  '- package.json with working "npm test" and "npm start".',
  '',
  'Frontend (Shuri → frontend/): React + Vite —',
  '- pick strategy + params + GBM seed/drift/vol, run the backtest via the backend',
  '- visualize equity curve vs buy-and-hold, drawdown curve, trade list, metrics table',
  '- package.json with working "npm run dev" and "npm run build".',
  '',
  'Run any dev/test server with start_service, NOT `Bash ... &`. Finish your COMPLETE part (all files,',
  'tests passing, integration working) before stopping. Make it ACTUALLY RUN and pass its tests.'
].join('\n')

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stderr?.on('data', (d) => process.stderr.write('[main:err] ' + d.toString()))
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async (cwd) => {
  const eps = await window.api.endpoints.list()
  const anthropic = eps.find((e) => e.protocol === 'anthropic')
  if (!anthropic || !anthropic.hasKey) return { ok: false, why: 'anthropic endpoint has no key' }
  // Use existing bindings (highest thinking tier) — do NOT setBinding (would reset thinking_depth).
  for (const r of ['coordinator', 'engineer', 'shuri']) {
    if (!(await window.api.roles.listBindings()).find((x) => x.roleId === r)?.endpointId)
      return { ok: false, why: `${r} not bound` }
  }
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ engineer: cwd, shuri: cwd }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ engineer: 'bypass', shuri: 'bypass' }))
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'coordinator' }))
  return { ok: true }
}, CWD)
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP —', setup.why); await app.close(); process.exit(0) }

await page.reload()
await page.waitForTimeout(1500)
await page.fill('textarea.cmp-textarea', TASK)
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
console.log('sent larger collab task at', new Date().toISOString(), '— running to quiescence...')

const fileCount = () => (existsSync(CWD) ? readdirSync(CWD, { recursive: true }).filter((f) => !f.includes('node_modules')).length : 0)
let idle = 0
const MAX = 840 // 70 min ceiling
for (let i = 0; i < MAX; i++) {
  await page.waitForTimeout(5000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
  const running = !!(await page.$('.cmp-stop'))
  if (!running && i > 3) { idle++; if (idle >= 4) { console.log('finished (idle 20s) at', new Date().toISOString()); break } } else idle = 0
  if (i % 24 === 0) console.log(`  [${i * 5}s] running=${running} files=${fileCount()}`)
}
await page.waitForTimeout(2000)
await page.screenshot({ path: '/tmp/bigger-collab.png', fullPage: true }).catch(() => {})

const probe = await page.evaluate(async () => {
  const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === 'coordinator')
  if (!c) return null
  const project = c.projectId ? await window.api.project.get(c.projectId) : null
  return {
    convId: c.id,
    project: project ? { title: project.title, phase: project.phase, plan: project.plan.map((t) => ({ who: t.assigneeRoleId, status: t.status })), consults: project.consults?.length ?? 0 } : null
  }
})
const startedAt = '2026-06-04'
const files = existsSync(CWD) ? readdirSync(CWD, { recursive: true }).filter((f) => !f.includes('node_modules')) : []
writeFileSync(REPORT, JSON.stringify({ task: 'backtester-collab', finishedAt: new Date().toISOString(), pageErrors: errors, probe, files }, null, 2))
console.log('=== PROJECT ===', JSON.stringify(probe?.project))
console.log('=== FILE TREE (' + files.length + ') ===\n' + files.join('\n'))
console.log('pageErrors:', errors.length)
await app.close()
process.exit(0)
