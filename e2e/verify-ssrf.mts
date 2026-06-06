// Verify the WebFetch SSRF guards against the REAL source (Node 24 strips the types). Two gates:
//   - checkUrlSsrf: pre-flight rejection of a host that resolves private
//   - ssrfSafeLookup: the connect-time DNS gate — a real https.request through it to a host that
//     resolves to a private/loopback IP must FAIL at connection (the DNS-rebinding backstop), while a
//     public host connects. localtest.me resolves to loopback (::1 / 127.0.0.1) yet has a dot, so it
//     slips past the cheap hostname heuristic and exercises the resolve-then-validate path for real.
//   Run: node e2e/verify-ssrf.mts
import { request as httpsRequest } from 'node:https'
import { ssrfSafeLookup, checkUrlSsrf } from '../src/main/agent/tools/ssrf.ts'

function tryConnect(url: string): Promise<{ ok: boolean; status?: number; err?: string }> {
  return new Promise((resolve) => {
    const req = httpsRequest(url, { lookup: ssrfSafeLookup, agent: false, signal: AbortSignal.timeout(10_000) }, (res) => {
      res.resume()
      resolve({ ok: true, status: res.statusCode })
    })
    req.on('error', (e: Error) => resolve({ ok: false, err: e.message }))
    req.end()
  })
}

const connectPrivate = await tryConnect('https://localtest.me/') // → loopback; must be blocked at connect
const connectPublic = await tryConnect('https://example.com/') //  public; must connect
const checkPrivate = await checkUrlSsrf('http://localtest.me/admin')
const checkPublic = await checkUrlSsrf('https://example.com/')
const checkMeta = await checkUrlSsrf('http://169.254.169.254/latest/meta-data/') // cloud metadata IP literal

console.log('connect localtest.me :', JSON.stringify(connectPrivate))
console.log('connect example.com  :', JSON.stringify(connectPublic))
console.log('checkUrlSsrf localtest.me :', checkPrivate)
console.log('checkUrlSsrf example.com  :', checkPublic)
console.log('checkUrlSsrf 169.254.169.254 :', checkMeta)

const fails: string[] = []
// Gate 2 (connect-time): private host must be refused by the lookup, public must go through.
if (connectPrivate.ok) fails.push('ssrfSafeLookup did NOT block a loopback-resolving host at connect time')
if (!connectPrivate.err || !/ssrf guard/.test(connectPrivate.err)) fails.push(`connect error was not the ssrf-guard error: ${connectPrivate.err}`)
if (!connectPublic.ok) fails.push(`public host failed to connect through ssrfSafeLookup (rewrite regression?): ${connectPublic.err}`)
// Gate 1 (pre-flight): private resolves + metadata IP rejected, public allowed.
if (!checkPrivate) fails.push('checkUrlSsrf allowed a loopback-resolving host')
if (checkPublic !== null) fails.push(`checkUrlSsrf blocked a public host: ${checkPublic}`)
if (!checkMeta) fails.push('checkUrlSsrf allowed the cloud-metadata IP 169.254.169.254')

console.log(
  fails.length
    ? '\n✗ FAIL:\n  - ' + fails.join('\n  - ')
    : `\n✓ PASS — both SSRF gates hold: connect to a loopback-resolving host is refused at the socket ("${connectPrivate.err}"), public host connects (HTTP ${connectPublic.status}); pre-flight blocks loopback + 169.254.169.254 and allows public`
)
process.exit(fails.length ? 1 : 0)
