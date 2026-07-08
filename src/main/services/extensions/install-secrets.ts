// One-shot secret hand-off for the install confirmation dialog (docs/extension-install-design.md §5.4).
// An MCP install may need env/header values. Those values must NEVER transit the model: tool inputs are
// persisted in transcripts, and the agent must never see or handle them. So the dialog sends the values
// straight to the main process here (renderer → extensions:stashSecrets → token), and the permission
// decision's updatedInput carries only the opaque token; install_mcp redeems it once, main-side, and
// hands the values to the keychain. Single-redeem + short TTL keeps the window minimal.

import { ulid } from '../../db/id'

const TTL_MS = 10 * 60 * 1000 // the dialog→approve→tool-call gap is seconds; 10min covers a slow user

interface Entry {
  values: Record<string, string>
  expiresAt: number
}

const stash = new Map<string, Entry>()

function sweep(): void {
  const now = Date.now()
  for (const [token, e] of stash) if (e.expiresAt <= now) stash.delete(token)
}

export function stashInstallSecrets(values: Record<string, string>): string {
  sweep()
  const token = ulid()
  stash.set(token, { values, expiresAt: Date.now() + TTL_MS })
  return token
}

// Redeem exactly once — the entry is deleted whether or not it expired.
export function redeemInstallSecrets(token: string): Record<string, string> | null {
  sweep()
  const e = stash.get(token)
  stash.delete(token)
  return e ? e.values : null
}
