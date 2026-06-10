// IANA timezone catalog for the profile picker. Built from Intl.supportedValuesOf('timeZone') (~418 ids
// in Chromium) instead of a hand-kept list: complete, follows ICU updates, and the continent grouping
// falls out of the id prefix (Asia/, Europe/, …). Offsets are computed for the CURRENT instant via
// Intl longOffset, so DST zones show their actual offset today (America/New_York reads -04:00 in
// summer) rather than a hardcoded standard offset. The persisted value is the IANA id (or 'auto' =
// follow the OS) — display strings are derived, never stored.

export interface TzEntry {
  id: string // IANA id, e.g. "Asia/Shanghai" — the persisted value
  city: string // last id segment, underscores → spaces, e.g. "Buenos Aires"
  offsetMin: number // current UTC offset in minutes (sort key)
  offsetText: string // "UTC+08:00"
}
export interface TzGroup {
  region: string // i18n key suffix: asia / europe / america / africa / oceania / pacific / atlantic / indian / antarctica / other
  entries: TzEntry[]
}

const REGION_BY_PREFIX: Record<string, string> = {
  Asia: 'asia',
  Europe: 'europe',
  America: 'america',
  Africa: 'africa',
  Australia: 'oceania',
  Pacific: 'pacific',
  Atlantic: 'atlantic',
  Indian: 'indian',
  Antarctica: 'antarctica'
}
const REGION_ORDER = ['asia', 'europe', 'america', 'africa', 'oceania', 'pacific', 'atlantic', 'indian', 'antarctica', 'other']

// The OS timezone right now — what 'auto' resolves to.
export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function isValidTimezone(id: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: id })
    return true
  } catch {
    return false
  }
}

function offsetOf(tz: string): { min: number; text: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date())
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    if (name === 'GMT') return { min: 0, text: 'UTC+00:00' } // longOffset gives bare "GMT" at zero
    const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name)
    if (!m) return null
    const min = (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10))
    return { min, text: `UTC${m[1]}${m[2]}:${m[3]}` }
  } catch {
    return null
  }
}

const cityOf = (id: string): string => (id.split('/').pop() || id).replace(/_/g, ' ')

// "(UTC+08:00) Shanghai" — the display form for a picked zone.
export function tzLabel(id: string): string {
  const off = offsetOf(id)
  return off ? `(${off.text}) ${cityOf(id)}` : cityOf(id)
}

let cache: TzGroup[] | null = null
// Grouped catalog, built once per session on first open (≈418 × Intl.DateTimeFormat ≈ tens of ms).
// Offsets freeze at build time — fine for a settings picker.
export function timezoneGroups(): TzGroup[] {
  if (cache) return cache
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  const ids = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : ['UTC']
  const byRegion = new Map<string, TzEntry[]>()
  for (const id of ids) {
    const off = offsetOf(id)
    if (!off) continue
    const region = id.includes('/') ? (REGION_BY_PREFIX[id.split('/')[0]] ?? 'other') : 'other' // bare ids (UTC) → other
    const list = byRegion.get(region) ?? []
    list.push({ id, city: cityOf(id), offsetMin: off.min, offsetText: off.text })
    byRegion.set(region, list)
  }
  cache = REGION_ORDER.filter((r) => byRegion.has(r)).map((r) => ({
    region: r,
    entries: byRegion.get(r)!.sort((a, b) => a.offsetMin - b.offsetMin || a.city.localeCompare(b.city))
  }))
  return cache
}
