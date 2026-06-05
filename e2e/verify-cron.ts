// Unit check for the zero-dep cron/interval/schedule parser (batch 1). The schedule string is a parsing
// surface with no good way to drive through the UI deterministically (it'd need the model to emit exact
// cron), so we exercise it directly. Run: node --experimental-strip-types e2e/verify-cron.ts
import { parseCron, nextCronRun, intervalToCron, parseSchedule } from '../src/main/agent/scheduler/cron.ts'

const fails: string[] = []
const ok = (cond: boolean, msg: string): void => { if (!cond) fails.push(msg) }

// parseCron — validity
ok(parseCron('0 9 * * 1-5') !== null, 'weekday 9am should parse')
ok(parseCron('*/5 * * * *') !== null, '*/5 should parse')
ok(parseCron('0,30 9 * * *') !== null, 'list 0,30 should parse')
ok(parseCron('0 9 * *') === null, '4-field must be invalid')
ok(parseCron('99 9 * * *') === null, 'minute 99 invalid')
ok(parseCron('0 9 * * 7') === null, 'dow 7 invalid (0-6)')

// intervalToCron
ok(intervalToCron('5m') === '*/5 * * * *', '5m → */5 * * * *')
ok(intervalToCron('30m') === '*/30 * * * *', '30m → */30 * * * *')
ok(intervalToCron('2h') === '0 */2 * * *', '2h → 0 */2 * * *')
ok(intervalToCron('1d') === '0 0 */1 * *', '1d → 0 0 */1 * *')
ok(intervalToCron('xyz') === null, 'non-interval → null')
ok(intervalToCron('90m') === null, '90m out of range → null')

// nextCronRun — weekday 9am, from Wed 2026-06-03 10:00 local → next is Thu 2026-06-04 09:00
const from = new Date(2026, 5, 3, 10, 0, 0).getTime()
const next = nextCronRun('0 9 * * 1-5', from)
ok(next !== null, 'nextCronRun finds a time')
if (next) {
  const d = new Date(next)
  ok(d.getHours() === 9 && d.getMinutes() === 0, `fire at 9:00, got ${d.getHours()}:${d.getMinutes()}`)
  ok(d.getDay() >= 1 && d.getDay() <= 5, `fire on a weekday, got dow ${d.getDay()}`)
  ok(next > from, 'next is in the future')
}
// same-day before 9am → should fire today 9am (Mon 2026-06-01 08:00 → today 09:00)
const beforeNine = new Date(2026, 5, 1, 8, 0, 0).getTime()
const n2 = nextCronRun('0 9 * * 1-5', beforeNine)
ok(n2 !== null && new Date(n2).getDate() === 1 && new Date(n2).getHours() === 9, 'before-9am fires today 9am')

// parseSchedule — three input shapes
const now = Date.now()
ok(parseSchedule('5m', now)?.recurring === true, 'parseSchedule 5m recurring')
ok(parseSchedule('0 9 * * 1-5', now)?.recurring === true, 'parseSchedule cron recurring')
const oneShot = parseSchedule('2030-01-15T15:00', now)
ok(oneShot?.recurring === false && oneShot?.cron === null, 'ISO → one-shot (cron null)')
ok(!!oneShot && oneShot.nextRunAt > now, 'one-shot in the future')
ok(parseSchedule('garbage', now) === null, 'garbage → null')
ok(parseSchedule('2020-01-01T00:00', now) === null, 'past time → null')

console.log(fails.length ? '✗ FAIL:\n  - ' + fails.join('\n  - ') : '✓ PASS — cron / interval / schedule parsing all correct')
process.exit(fails.length ? 1 : 0)
