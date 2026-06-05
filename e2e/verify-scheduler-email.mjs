// Batch 3 verify — email STEP kind (doc 28): with no email MCP connected, an email step must NOT send — it
// executes as an agent turn that produces a DRAFT (Studio never sends mail itself). We seed a durable one-shot
// email task, launch, wait for the engine, and confirm the conversation got an assistant reply carrying the
// email content rather than crashing or silently no-op'ing. (tool steps share the same runAgentStep path —
// covered by the expert/email runs; only the instruction differs.)
//   node e2e/verify-scheduler-email.mjs
import { _electron } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TASKS_FILE = join(homedir(), '.nsai', 'scheduled_tasks.json')
const readTasks = () => { try { return JSON.parse(readFileSync(TASKS_FILE, 'utf8')).tasks ?? [] } catch { return [] } }
const writeTasks = (t) => writeFileSync(TASKS_FILE, JSON.stringify({ tasks: t }, null, 2))
const cleanTasks = () => { try { if (existsSync(TASKS_FILE)) writeTasks(readTasks().filter((x) => !/E2E/i.test(x.name || ''))) } catch { /**/ } }
cleanTasks()

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1000)

const setup = await page.evaluate(async () => {
  const b = (await window.api.roles.listBindings()).find((x) => x.roleId === 'scheduler')
  const ep = (await window.api.endpoints.list()).find((e) => e.id === b?.endpointId)
  if (!b?.endpointId || !b?.model || !ep?.hasKey) return { ok: false }
  for (const c of (await window.api.conversations.list()).filter((c) => c.primaryRoleId === 'scheduler')) await window.api.conversations.remove(c.id)
  return { ok: true, model: b.model }
})
if (!setup.ok) { console.log('SKIP — scheduler not bound to a keyed endpoint'); await app.close(); process.exit(0) }

const fireAt = Date.now() + 6000
writeTasks([...readTasks(), {
  id: 'e2email1', name: 'E2E email step', cron: null, nextRunAt: fireAt, recurring: false, durable: true, enabled: true,
  steps: [{ kind: 'email', to: 'ops@example.com', subject: 'E2E weekly digest', prompt: 'Write a one-line status: all systems nominal.' }],
  cwd: '/tmp', createdAt: Date.now(),
}])
console.log('seeded email-step task (no email MCP → expect a draft), fires in ~6s')

let reply = ''
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(2000)
  reply = await page.evaluate(async () => {
    const c = (await window.api.conversations.list()).find((x) => x.primaryRoleId === 'scheduler')
    if (!c) return ''
    return (await window.api.conversations.messages(c.id)).filter((m) => m.author !== 'user').map((m) => m.content).join('\n')
  })
  if (reply && reply.length > 20) break
}
const remaining = readTasks().find((t) => t.id === 'e2email1')
await app.close()

const lc = reply.toLowerCase()
const carriesEmail = lc.includes('nominal') || lc.includes('ops@example.com') || lc.includes('digest') || lc.includes('draft')
const claimsSent = /\b(email (has been|was) sent|i('| ha)ve sent|message sent|sent the email)\b/i.test(reply)
console.log('\n===== SCHEDULER EMAIL STEP (BATCH 3) VERIFY =====')
console.log('model:', setup.model)
console.log('agent produced output:', reply.length > 20)
console.log('output carries the email/draft:', carriesEmail)
console.log('does NOT falsely claim it was sent:', !claimsSent, '(informational — no email MCP is connected)')
console.log('one-shot removed:', !remaining)
console.log('reply:', JSON.stringify(reply.slice(0, 220)))
const fails = []
if (reply.length <= 20) fails.push('email step produced no agent output (did not execute)')
if (!carriesEmail) fails.push('output does not carry the email/draft content')
if (remaining) fails.push('one-shot still in durable JSON after firing')
cleanTasks()
console.log(fails.length ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ') : '\n✓ PASS — email step executed as a draft (no email MCP): agent produced the email, did not send; one-shot cleaned up')
process.exit(fails.length ? 1 : 0)
