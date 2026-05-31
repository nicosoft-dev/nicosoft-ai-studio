import { safeStorage, app } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// API keys encrypted at rest with Electron safeStorage (OS-backed key). Ciphertext lives in a JSON
// file under userData keyed by endpoint id. Only this layer touches secrets — SQLite holds no keys.
// Services call here; repos/adapters never do.

export class KeychainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeychainError'
  }
}

function file(): string {
  return join(app.getPath('userData'), 'credentials.json')
}

function load(): Record<string, string> {
  const f = file()
  if (!existsSync(f)) return {}
  try {
    return JSON.parse(readFileSync(f, 'utf-8')) as Record<string, string>
  } catch {
    // Corrupt file: preserve it instead of letting the next save() silently wipe every stored key.
    try {
      renameSync(f, f + '.corrupt')
    } catch {
      /* best effort */
    }
    return {}
  }
}

function save(map: Record<string, string>): void {
  const f = file()
  const tmp = f + '.tmp'
  writeFileSync(tmp, JSON.stringify(map), { mode: 0o600 })
  renameSync(tmp, f) // atomic on the same filesystem — a crash mid-write can't corrupt the store
}

export function setApiKey(endpointId: string, key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Don't persist a key the OS can't actually encrypt (e.g. Linux with no keyring) — surface it.
    throw new KeychainError('OS encryption is unavailable; refusing to store the API key unprotected')
  }
  const map = load()
  map[endpointId] = safeStorage.encryptString(key).toString('base64')
  save(map)
}

export function getApiKey(endpointId: string): string | null {
  const enc = load()[endpointId]
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export function deleteApiKey(endpointId: string): void {
  const map = load()
  if (endpointId in map) {
    delete map[endpointId]
    save(map)
  }
}

export function hasApiKey(endpointId: string): boolean {
  return endpointId in load()
}
