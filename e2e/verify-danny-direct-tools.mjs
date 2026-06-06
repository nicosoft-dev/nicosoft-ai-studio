// Verify Part 2: Danny (coordinator) in DIRECT mode can use his read-only kit (Read/Glob/WebSearch) to
// answer a quick lookup himself instead of dispatching. Proof: we plant a unique secret that exists ONLY
// in a local file; if Danny's OWN direct reply (expertId === 'coordinator') echoes that secret, he must
// have Read the file with his read-only tool (the token isn't in any model's training data). MANUAL —
// real LLM. SKIPs if coordinator isn't bound to a keyed agent-capable endpoint.
//   node e2e/verify-danny-direct-tools.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CWD = '/tmp/e2e-danny'
const SECRET = 'ZEBRA-4471-QUARTZ-9920' // unique token, only in the planted file
rmSync(CWD, { recursive: true, force: true })
mkdirSync(CWD, { recursive: true })
writeFileSync(join(CWD, 'notes.txt'), `Project notes.\n\nThe access code is ${SECRET}.\nKeep it handy.\n`)

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async () => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'coordinator')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'coordinator')) await window.api.conversations.remove(c.id)
  return { ok: true, model: b.model, protocol: ep.protocol }
})
console.log('coordinator:', JSON.stringify(setup))
if (!setup.ok) { console.log('SKIP — coordinator not bound to a keyed endpoint'); await app.close(); process.exit(0) }

await page.evaluate((cwd) => {
  localStorage.setItem('nicosoft-studio-cwd-by-expert', JSON.stringify({ coordinator: cwd }))
  localStorage.setItem('nicosoft-studio-mode-by-expert', JSON.stringify({ coordinator: 'bypass' }))
  localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'app', activeExpert: 'coordinator' }))
}, CWD)
await page.reload()
await page.waitForTimeout(1500)
await page.fill(
  'textarea.cmp-textarea',
  'Quick one, Danny — just read notes.txt in your folder and tell me the access code in it. Handle it yourself, no need to bring in a specialist.'
)
await page.keyboard.press('Enter')
console.log('asked Danny to read notes.txt himself...')

for (let i = 0; i < 50; i++) {
  await page.waitForTimeout(2000)
  if (await page.$('.ap-allow')) await page.$eval('.ap-allow', (e) => e.click())
  if (!(await page.$('.cmp-stop')) && i > 2) break
}
await page.waitForTimeout(1500)

const probe = await page.evaluate(async () => {
  const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === 'coordinator')
  if (!c) return {}
  const t = await window.api.agent.transcript(c.id)
  const tools = Object.values(t).flatMap((r) => r.tools.map((x) => x.name))
  const msgs = await window.api.conversations.messages(c.id)
  // The assistant turn(s) that answered, with who authored each.
  const answers = msgs.filter((m) => m.author !== 'user').map((m) => ({ expert: m.expertId, text: m.content }))
  return { tools, answers }
})
await app.close()
rmSync(CWD, { recursive: true, force: true })

const danny = (probe.answers ?? []).filter((a) => a.expert === 'coordinator')
const dannyText = danny.map((a) => a.text).join('\n')
const someoneElse = (probe.answers ?? []).find((a) => a.expert && a.expert !== 'coordinator')

console.log('tools:', JSON.stringify(probe.tools))
console.log('answers by:', JSON.stringify((probe.answers ?? []).map((a) => a.expert)))
console.log('Danny reply:', JSON.stringify(dannyText.replace(/\s+/g, ' ').trim().slice(0, 160)))

const fails = []
if (!danny.length) {
  fails.push(`Danny did not answer directly — routed to ${someoneElse?.expert ?? 'unknown'} instead (direct-with-tools not exercised; try rephrasing as a clearer quick self-lookup)`)
} else {
  if (!probe.tools?.includes('Read')) fails.push('direct mode did not call Read (read-only kit not wired into the coordinator agent loop?)')
  if (!dannyText.includes(SECRET)) fails.push(`Danny's direct reply does not contain the file-only secret ${SECRET} — he did not actually read the file`)
}
console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : `\n✓ PASS — Danny answered DIRECTLY (expertId=coordinator), called Read, and echoed the file-only secret ${SECRET}: his read-only kit works in direct mode`
)
process.exit(fails.length ? 1 : 0)
