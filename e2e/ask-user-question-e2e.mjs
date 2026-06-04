// Runtime verify for AskUserQuestion (batch 2). engineer is told to ask via AskUserQuestion; the test
// waits for the QuestionDialog, clicks the first option, and checks the picked answer reaches the agent
// (the reply names it). Proves the full bridge: tool -> ctx.askUser -> IPC -> dialog -> respond -> result.
//   node e2e/ask-user-question-e2e.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const events = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stdout?.on('data', (d) => { for (const line of d.toString().split('\n')) { const m = line.match(/\[agent-event\] (.+)$/); if (m) { try { events.push(JSON.parse(m[1])) } catch { /* partial */ } } } })
app.process().stderr?.on('data', () => {})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async () => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'engineer')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false, why: 'engineer not bound to a keyed endpoint' }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'engineer')) await window.api.conversations.remove(c.id)
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ engineer: '/tmp' }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ engineer: 'bypass' }))
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'engineer' }))
  return { ok: true, thinkingDepth: b.thinkingDepth, model: b.model }
})
console.log('setup:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP —', setup.why); await app.close(); process.exit(0) }

await page.reload()
await page.waitForTimeout(1500)
await page.fill('textarea.cmp-textarea', 'Use the AskUserQuestion tool to ask me whether this project should use Postgres or SQLite (exactly two options: "Postgres" and "SQLite"). After I answer, reply in ONE line telling me which one I picked.')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')

let dialogShown = false
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1500)
  if (await page.$('.q-option')) { dialogShown = true; break }
  if (!(await page.$('.cmp-stop')) && i > 2) break
}
let picked = ''
if (dialogShown) {
  picked = (await page.$eval('.q-option .q-opt-text', (e) => e.textContent)) || ''
  await page.$eval('.q-option', (e) => e.click()) // pick the first option
}
console.log('dialog shown:', dialogShown, '| picked first option:', JSON.stringify(picked))

let finished = false
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
  if (!(await page.$('.cmp-stop')) && i > 1) { finished = true; break }
}
await page.waitForTimeout(800)

const reply = await page.evaluate(async () => {
  const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === 'engineer')
  if (!c) return ''
  return (await window.api.conversations.messages(c.id)).filter((m) => m.author !== 'user').map((m) => m.content).join('\n')
})
const usedAsk = events.some((e) => e.type === 'tool:pre' && e.tool === 'AskUserQuestion')
await app.close()
console.log('usedAsk:', usedAsk, '| finished:', finished, '| reply:', JSON.stringify((reply || '').slice(0, 160)))
const fails = []
if (!usedAsk) fails.push('engineer did not call AskUserQuestion')
if (!dialogShown) fails.push('QuestionDialog did not appear')
if (picked && !new RegExp(picked, 'i').test(reply || '')) fails.push(`reply does not mention the picked option "${picked}" — the answer may not have reached the agent`)
console.log(fails.length ? '✗ FAIL:\n  - ' + fails.join('\n  - ') : `✓ PASS — AskUserQuestion showed the dialog; the picked answer "${picked}" reached the agent`)
process.exit(fails.length ? 1 : 0)
