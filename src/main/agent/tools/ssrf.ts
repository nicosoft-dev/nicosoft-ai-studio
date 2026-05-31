// SSRF guard for the WebFetch tool. The dedicated Read/Grep tools and bash args are path-confined,
// but WebFetch opens an OUTBOUND connection — a model coached into fetching an internal address
// (cloud metadata 169.254.169.254, localhost admin panels, RFC1918 ranges) must be blocked. We
// resolve the hostname and reject if ANY resolved address is private/loopback/link-local, so a
// public domain that points at an internal IP is caught too, not just IP-literal URLs.
//
// Residual risk: DNS rebinding after the check (TTL expiry → re-resolve to an internal IP at fetch
// time). A future hardening can pin the resolved IP into the fetch dispatcher; for now the check +
// the same-host-only redirect policy bound the exposure. Mirrors nsai's first-gate ValidateExternalURL.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// Returns null if the URL is safe to fetch, or a human-readable reason if it must be blocked.
export async function checkUrlSsrf(rawUrl: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'invalid URL'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `unsupported protocol ${url.protocol}`
  if (url.username || url.password) return 'credentials embedded in URL are not allowed'

  const host = url.hostname
  let ips: string[]
  if (isIP(host)) {
    ips = [host]
  } else {
    const lower = host.toLowerCase()
    // Single-label names and the localhost/.local suffixes are internal by convention.
    if (
      lower === 'localhost' ||
      lower.endsWith('.localhost') ||
      lower.endsWith('.local') ||
      lower.endsWith('.internal') ||
      !lower.includes('.')
    ) {
      return `internal hostname ${host}`
    }
    try {
      const records = await lookup(host, { all: true })
      ips = records.map((r) => r.address)
    } catch {
      return `cannot resolve ${host}`
    }
  }
  if (ips.length === 0) return `cannot resolve ${host}`
  for (const ip of ips) {
    if (isPrivateIp(ip)) return `${host} resolves to a non-public address (${ip})`
  }
  return null
}

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return isPrivateV4(ip)
  if (v === 6) return isPrivateV6(ip)
  return true // unparseable → reject (fail closed)
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map((n) => Number(n))
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return (
    a === 0 || // 0.0.0.0/8 unspecified
    a === 10 || // 10/8 private
    a === 127 || // 127/8 loopback
    (a === 169 && b === 254) || // 169.254/16 link-local (cloud metadata!)
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
    (a === 192 && b === 168) || // 192.168/16 private
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
    a >= 224 // 224/4 multicast + 240/4 reserved
  )
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (lower === '::1' || lower === '::') return true // loopback / unspecified
  // IPv4-mapped (::ffff:127.0.0.1) — a common way to smuggle a v4 internal address past a v6 check.
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateV4(mapped[1]!)
  return (
    lower.startsWith('fe80') || // link-local
    lower.startsWith('fc') || // unique-local fc00::/7
    lower.startsWith('fd') ||
    lower.startsWith('ff') // multicast
  )
}
