// Verify the Overview (Studio Home) shows REAL data — no mock. We run engineer (which records usage with its
// expertId + makes tool calls today), then open Overview → Stats and assert the analytics summary reflects
// that run: by-expert has engineer with tokens, by-provider has the real provider, and "tool calls today" is
// non-empty. Screenshots both tabs. MANUAL — real LLM. SKIPs if engineer isn't bound to a keyed endpoint.
//   node e2e/verify-overview.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/e2e-overview'
const SHOTS = '/tmp/e2e-overview-shots'
rmSync(CWD, { recursive: true, force: true })
mkdirSync(CWD, { recursive: true })
mkdirSync(SHOTS, { recursive: true })
writeFileSync(join(CWD, 'package.json'), JSON.stringify({ name: 'overview-fixture', version: '1.0.0' }, null, 2))

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async (cwd) => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'engineer')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false }
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'engineer' }))
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ engineer: cwd }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ engineer: 'bypass' }))
  return { ok: true, provider: ep.protocol }
}, CWD)
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP — engineer not bound to a keyed endpoint'); await app.close(); process.exit(0) }
await page.reload()
await page.waitForTimeout(1500)

// fresh activity: a couple of tool calls today + a usage_events row tagged with expert_id=engineer
await page.fill('textarea.cmp-textarea', 'Read package.json in the current folder and tell me the "name" field, then write that name into a file called name.txt.')
await page.keyboard.press('Enter')
console.log('engineer: read package.json + write name.txt ...')
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(2000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
  if (!(await page.$('.cmp-stop')) && i > 2) break
}
await page.waitForTimeout(1000)

// open Overview
await page.locator('.studio-nav-row', { hasText: 'Overview' }).first().click()
await page.waitForTimeout(1000)
await page.screenshot({ path: join(SHOTS, 'activity.png') })

// switch to Stats
await page.locator('.studio-tabs button', { hasText: 'Stats' }).first().click()
await page.waitForTimeout(1200)
await page.screenshot({ path: join(SHOTS, 'stats.png') })

const probe = await page.evaluate(async () => {
  const a = await window.api.analytics.summary()
  return {
    byExpert: a.usage.byExpert,
    engineerTokens: a.usage.byExpert.find((r) => r.id === 'engineer')?.v ?? 0,
    byProvider: a.usage.byProvider.map((r) => r.label),
    tokensAllTime: a.usage.tokensAllTime,
    toolsToday: a.activity.tools,
    convTotal: a.usage.conversationsTotal,
    memoryTotal: a.memory.total
  }
})
// DOM check: the Stats page rendered real cards (not the loading state)
const dom = await page.evaluate(() => ({
  cards: document.querySelectorAll('.an-card').length,
  hasUsage: !!document.querySelector('.token-totals'),
  bars: document.querySelectorAll('.bar-row').length
}))

await page.evaluate(async () => { for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'engineer')) await window.api.conversations.remove(c.id) })
await app.close()
rmSync(CWD, { recursive: true, force: true })

console.log('summary:', JSON.stringify(probe))
console.log('stats DOM:', JSON.stringify(dom))
console.log('screenshots:', join(SHOTS, 'activity.png'), '+', join(SHOTS, 'stats.png'))

const fails = []
if (probe.engineerTokens <= 0) fails.push('by-expert has no engineer tokens — usage_events expert_id not recorded / aggregation broken')
if (!probe.byProvider.length) fails.push('by-provider empty — provider aggregation broken')
if (probe.toolsToday.length === 0) fails.push('tool-calls-today empty — transcript ts / scan not working (engineer used Read + Write)')
if (probe.tokensAllTime <= 0) fails.push('tokens all-time is zero')
if (dom.cards < 8 || !dom.hasUsage) fails.push(`Stats page did not render the real cards (cards=${dom.cards}, usage=${dom.hasUsage})`)
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : `\n✓ PASS — Overview Stats is real: engineer ${probe.engineerTokens} tokens by-expert, providers ${JSON.stringify(probe.byProvider)}, tools today ${JSON.stringify(probe.toolsToday)}, ${dom.cards} cards rendered`
)
process.exit(fails.length ? 1 : 0)
