// Deterministic regression for the orchestration tool-card timeline (doc 19). Seeds a throwaway project
// with two doer lanes + a strip of tool events straight into the DB (no LLM), opens it, and asserts the
// lanes render tool cards (READ/WRITE/BASH/EDIT…) with zone badges and a horizontally-scrolling track —
// then deletes the throwaway project (cascade clears its rows). The live capture path is covered separately
// by a real collab; this guards the DTO→render contract cheaply.
//   node e2e/project-tool-timeline-e2e.mjs
import { _electron } from 'playwright'
import { strict as assert } from 'node:assert'
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DB = join(homedir(), '.nsai', 'studio.db')
const PID = 'tt-e2e-proj'

function seed() {
  const db = new DatabaseSync(DB)
  db.exec(
    `CREATE TABLE IF NOT EXISTS project_tool_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, role_id TEXT NOT NULL, src_id TEXT, seq INTEGER NOT NULL, tool_name TEXT NOT NULL, target TEXT, zone TEXT NOT NULL DEFAULT 'green', created_at TEXT NOT NULL);
     CREATE UNIQUE INDEX IF NOT EXISTS idx_pte_src ON project_tool_events (project_id, src_id);`,
  )
  const now = new Date().toISOString()
  // node:sqlite defaults foreign_keys=OFF (no cascade), so clear children explicitly before re-seeding.
  for (const t of ['project_tool_events', 'project_consults', 'project_tests', 'project_tasks']) db.prepare(`DELETE FROM ${t} WHERE project_id=?`).run(PID)
  db.prepare('DELETE FROM projects WHERE id=?').run(PID)
  db.prepare('INSERT INTO projects (id,title,goal,cwd,phase,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(PID, 'Tool timeline e2e', 'seeded', null, 'executing', now, now)
  for (const [i, r] of ['engineer', 'shuri'].entries())
    db.prepare("INSERT INTO project_tasks (id,project_id,step_no,title,assignee_role_id,deps,status,output,created_at) VALUES (?,?,?,?,?,'[]','doing',NULL,?)").run('tt-task-' + i, PID, i + 1, r + ' work', r, now)
  const evs = [
    ['engineer', 'Read', 'server.js', 'green'], ['engineer', 'Write', 'server.js', 'green'], ['engineer', 'Bash', 'node test.js', 'yellow'],
    ['engineer', 'Edit', 'server.js', 'green'], ['engineer', 'Bash', 'rm -rf /tmp/x', 'red'], ['engineer', 'Read', 'package.json', 'green'],
    ['engineer', 'Write', 'routes/users.js', 'green'], ['engineer', 'Edit', 'db.js', 'green'], ['engineer', 'Bash', 'node server.js', 'yellow'],
    ['shuri', 'Read', 'index.html', 'green'], ['shuri', 'Write', 'app.js', 'green'], ['shuri', 'Bash', 'npm i', 'yellow'], ['shuri', 'Grep', 'fetch(', 'green'],
  ]
  evs.forEach(([role, name, target, zone], s) =>
    db.prepare('INSERT INTO project_tool_events (id,project_id,role_id,src_id,seq,tool_name,target,zone,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('tt-ev-' + s, PID, role, 'tt-ev-' + s, s + 1, name, target, zone, now),
  )
  db.close()
}
function cleanup() {
  const db = new DatabaseSync(DB)
  for (const t of ['project_tool_events', 'project_consults', 'project_tests', 'project_tasks']) db.prepare(`DELETE FROM ${t} WHERE project_id=?`).run(PID)
  db.prepare('DELETE FROM projects WHERE id=?').run(PID)
  db.close()
}

seed()
const app = await _electron.launch({ args: ['out/main/index.js'], cwd: PROJECT })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))
await page.waitForLoadState('domcontentloaded')
await page.evaluate((id) => localStorage.setItem('nicosoft-studio-state-v1', JSON.stringify({ view: 'projects', activeProject: id })), PID)
await page.reload()
await page.waitForTimeout(1800)

const geo = await page.evaluate(() => ({
  onDetail: !!document.querySelector('.wb-lanes'),
  doerCards: document.querySelectorAll('.wb-lane:not(.conductor) .wb-card:not(.consult-from)').length,
  conductorCards: document.querySelectorAll('.wb-lane.conductor .wb-card').length,
  autoTags: document.querySelectorAll('.wb-tag.auto').length,
  dangerTags: document.querySelectorAll('.wb-tag.danger').length,
  connectors: document.querySelectorAll('.wb-conn').length,
  gutterSticky: getComputedStyle(document.querySelector('.wb-gutter')).position === 'sticky',
  orchScrollX: (() => { const o = document.querySelector('.wb-orch'); return o ? o.scrollWidth - o.clientWidth : 0 })(),
  lanes: document.querySelectorAll('.wb-lane').length,
}))
console.log(JSON.stringify(geo, null, 2))
await page.screenshot({ path: '/tmp/orch-tools.png' })
await app.close()
cleanup()

assert.equal(errors.length, 0, 'no page errors:\n' + errors.join('\n'))
assert.ok(geo.onDetail, 'project detail rendered')
assert.equal(geo.doerCards, 13, `all 13 seeded tool events rendered as event cards (got ${geo.doerCards})`)
assert.ok(geo.conductorCards >= 1, `coordinator conductor ribbon rendered (got ${geo.conductorCards})`)
assert.ok(geo.autoTags >= 1 && geo.dangerTags >= 1, `yellow→auto-approved + red→needs-approval tags rendered (auto ${geo.autoTags}, danger ${geo.dangerTags})`)
assert.ok(geo.connectors > 0, 'cards joined by .wb-conn connectors')
assert.ok(geo.gutterSticky, 'lane gutters are sticky (stay while the track scrolls)')
assert.equal(geo.lanes, 3, `3 lanes: coordinator + 2 doers (got ${geo.lanes})`)
assert.ok(geo.orchScrollX > 0, `orchestration scrolls horizontally as one region (overflow ${geo.orchScrollX}px)`)
console.log('✓ orchestration 1:1 — conductor ribbon + event cards + zone tags + connectors + sticky gutters + single horizontal scroll')
process.exit(0)
