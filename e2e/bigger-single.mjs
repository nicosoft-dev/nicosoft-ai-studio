// LARGER acceptance run — single engineer (Flynn), after the optimization 1-3 fixes. A Trading Strategy
// Backtesting Engine (bigger + research-grade than the options platform). Verifies [2]/[3]: Flynn runs dev
// servers via start_service (detached, tree-killed) instead of a blocking Bash &, so the run completes to
// session:end without wedging or leaking processes. bypass mode (no approval stalls), session:end gate.
//   node e2e/bigger-single.mjs
import { _electron } from 'playwright'
import { existsSync, rmSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/backtester-single'
const REPORT = '/tmp/bigger-single.json'
rmSync(CWD, { recursive: true, force: true })
mkdirSync(CWD, { recursive: true })

const TASK = [
  'Build a Trading Strategy Backtesting Engine — a real, research-grade project (larger than a CRUD app),',
  'frontend/backend SEPARATED. You build BOTH sides yourself, end to end.',
  '',
  'Backend (backend/): Node.js + Express REST API —',
  '- Price-series data layer: synthetic OHLC series via geometric Brownian motion, configurable',
  '  drift/vol/seed, DETERMINISTIC for a fixed seed (reproducible backtests).',
  '- Strategies (each a pure function(prices, params) -> signals): SMA crossover, RSI mean-reversion,',
  '  MACD, momentum.',
  '- Backtest engine: run a strategy over a series, simulate trades (position sizing + commission),',
  '  produce an equity curve, the trade list, and performance metrics: total return, CAGR, Sharpe ratio,',
  '  max drawdown, win rate, profit factor. Include a buy-and-hold baseline.',
  '- A REAL Jest suite proving correctness: metrics on a known equity curve match hand-computed',
  '  Sharpe/maxDD; strategies emit expected signals on crafted series; buy-and-hold matches a',
  '  hand-computed return; the engine is deterministic for a fixed seed.',
  '- package.json with working "npm test" and "npm start".',
  '',
  'Frontend (frontend/): React + Vite —',
  '- pick strategy + params + GBM seed/drift/vol, run the backtest via the backend',
  '- visualize the equity curve vs buy-and-hold, the drawdown curve, the trade list, and a metrics table',
  '- package.json with working "npm run dev" and "npm run build".',
  '',
  'IMPORTANT: run any dev/test server with the start_service tool, NOT `Bash ... &`.',
  'Make it ACTUALLY RUN and pass its own tests. Research-grade, not a CRUD toy. Work it end to end.'
].join('\n')

const events = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stdout?.on('data', (d) => {
  for (const line of d.toString().split('\n')) {
    const m = line.match(/\[agent-event\] (.+)$/)
    if (m) { try { events.push(JSON.parse(m[1])) } catch { /* partial */ } }
  }
})
app.process().stderr?.on('data', () => {})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async (cwd) => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'engineer')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false, why: 'engineer not bound to a keyed endpoint' }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'engineer'))
    await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ engineer: cwd }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ engineer: 'bypass' })) // UI "Auto"
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'engineer' }))
  return { ok: true, thinkingDepth: b.thinkingDepth, model: b.model }
}, CWD)
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP —', setup.why); await app.close(); process.exit(0) }

await page.reload()
await page.waitForTimeout(1500)
await page.fill('textarea.cmp-textarea', TASK)
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
console.log('sent larger single-agent task at', new Date().toISOString(), '— running to session:end...')

const fileCount = () => (existsSync(CWD) ? readdirSync(CWD, { recursive: true }).filter((f) => !f.includes('node_modules')).length : 0)
const MAX = 840 // 840 × 5s = 70 min ceiling
let ended = false
for (let i = 0; i < MAX; i++) {
  await page.waitForTimeout(5000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click()) // shouldn't appear in bypass
  if (events.some((e) => e.type === 'session:end')) { ended = true; console.log('finished (session:end) at', new Date().toISOString()); break }
  if (i % 24 === 0) console.log(`  [${i * 5}s] running=${!!(await page.$('.cmp-stop'))} files=${fileCount()} events=${events.length}`)
}
if (!ended) console.log('ceiling reached WITHOUT session:end at', new Date().toISOString())
await page.waitForTimeout(2000)
await page.screenshot({ path: '/tmp/bigger-single.png', fullPage: true }).catch(() => {})

const toolCounts = {}
for (const e of events) if (e.type === 'tool:pre') toolCounts[e.tool] = (toolCounts[e.tool] || 0) + 1
const sessionEnds = events.filter((e) => e.type === 'session:end').map((e) => ({ turns: e.turns, reason: e.reason }))
const files = existsSync(CWD) ? readdirSync(CWD, { recursive: true }).filter((f) => !f.includes('node_modules')) : []
writeFileSync(REPORT, JSON.stringify({ task: 'backtester-single', finishedAt: new Date().toISOString(), ended, totalEvents: events.length, toolCounts, sessionEnds, files }, null, 2))
console.log('=== TOOL USE ===', JSON.stringify(toolCounts))
console.log('=== SESSION ENDS ===', JSON.stringify(sessionEnds))
console.log('=== FILE TREE (' + files.length + ') ===\n' + files.join('\n'))
await app.close()
process.exit(0)
