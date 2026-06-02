// End-to-end: a real Engineer (Hex) agent run CALLS a skill. Adds a builtin skill scoped to engineer
// (its body tells the model to emit a verification token), asks Hex to run it, and asserts the
// transcript shows a Skill tool call (name 'Skill', input.skill matching) — proving agent.service's
// skill injection (the Skill tool + the "Available skills" system listing) reaches the model end-to-end.
// MANUAL — real opus LLM (costs money); LLM tool choice can vary, rerun on a miss. Skips cleanly if the
// engineer endpoint has no key. Run: NS_KEY=<nsai-anthropic-key> node e2e/skills-hex-call.mjs
import { _electron } from 'playwright'
import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/engineer-skill-test'
const NS_KEY = process.env.NS_KEY || ''
mkdirSync(CWD, { recursive: true })

const errors = []
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
app.process().stderr?.on('data', (d) => process.stderr.write('[main:err] ' + d.toString()))
const page = await app.firstWindow()
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const added = await page.evaluate(
  async ({ cwd, key }) => {
    localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ engineer: cwd }))
    localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'engineer' }))
    const bindings = await window.api.roles.listBindings()
    const eng = bindings.find((b) => b.roleId === 'engineer')
    const eps = await window.api.endpoints.list()
    const ep = eps.find((e) => e.id === eng?.endpointId)
    if (ep && !ep.hasKey && key) await window.api.endpoints.update(ep.id, { apiKey: key })
    for (const s of await window.api.skills.list()) await window.api.skills.remove(s.id)
    const sk = await window.api.skills.add({
      source: 'builtin',
      name: 'echo-test',
      description: 'Emit a verification token',
      whenToUse: 'When asked to run the echo-test skill',
      body: 'Output exactly this token verbatim and nothing else: SKILL-OK-42',
      scope: ['engineer'],
      enabled: true
    })
    const ep2 = (await window.api.endpoints.list()).find((e) => e.id === eng?.endpointId)
    return { id: sk.id, name: sk.name, epHasKey: !!ep2?.hasKey }
  },
  { cwd: CWD, key: NS_KEY }
)
console.log('skill added:', JSON.stringify(added))

if (!added.epHasKey) {
  console.log('⚠ SKIP — engineer endpoint has no API key. Set NS_KEY=<key> to run the live Hex call.')
  await page.evaluate((id) => window.api.skills.remove(id), added.id)
  await app.close()
  process.exit(0)
}

await page.reload()
await page.waitForTimeout(1500)

await page.fill('textarea.cmp-textarea', 'Run the echo-test skill.')
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
console.log('sent prompt, waiting for the agent run...')

for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000)
  const allow = await page.$('.ap-allow')
  if (allow) {
    await allow.click()
    continue
  }
  if (!(await page.$('.cmp-stop')) && i > 1) break
}
await page.waitForTimeout(2000)
await page.screenshot({ path: '/tmp/skills-hex.png', fullPage: true })

const r = await page.evaluate(async () => {
  const convs = await window.api.conversations.list()
  const conv = convs.find((c) => c.primaryRoleId === 'engineer')
  const transcript = conv ? await window.api.agent.transcript(conv.id) : {}
  const calls = Object.values(transcript).flat()
  return { calls: calls.map((t) => ({ name: t.name, input: t.input })) }
})
console.log('tool calls:', JSON.stringify(r.calls))

await page.evaluate((id) => window.api.skills.remove(id), added.id) // cleanup

const skillCall = r.calls.find((c) => c.name === 'Skill')
assert.ok(skillCall, `Hex must call the Skill tool (got ${JSON.stringify(r.calls.map((c) => c.name))})`)
assert.equal(skillCall.input?.skill, 'echo-test', `Skill called with skill='echo-test' (got ${JSON.stringify(skillCall.input)})`)
console.log(`✓ Hex called the Skill tool end-to-end: skill='${skillCall.input.skill}'`)

console.log(errors.length ? '✗ page errors: ' + JSON.stringify(errors) : '✓ no page errors')
await app.close()
process.exit(errors.length ? 1 : 0)
