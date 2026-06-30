import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HookEventName } from './events'

const DIR = 'hook-env'
const ENV_FILE_EVENTS: ReadonlySet<HookEventName> = new Set(['Setup', 'SessionStart', 'CwdChanged', 'FileChanged'])

function eventPrefix(event: HookEventName): string {
  return event.toLowerCase()
}

export function hookEnvDir(sessionDir: string): string {
  return join(sessionDir, DIR)
}

export async function createHookEnvFile(sessionDir: string, event: HookEventName): Promise<string | undefined> {
  if (!ENV_FILE_EVENTS.has(event)) return undefined
  const dir = hookEnvDir(sessionDir)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `${eventPrefix(event)}-hook-${Date.now()}-${randomUUID()}.sh`)
  await writeFile(file, '', { flag: 'wx', mode: 0o600 })
  return file
}

export async function clearHookEnvFiles(sessionDir: string, prefixes: string[]): Promise<void> {
  const dir = hookEnvDir(sessionDir)
  const entries = await readdir(dir).catch(() => [])
  await Promise.all(
    entries
      .filter((name) => prefixes.some((prefix) => name.startsWith(`${prefix}-hook-`)) && name.endsWith('.sh'))
      .map((name) => rm(join(dir, name), { force: true }).catch(() => undefined)),
  )
}

export function hasHookEnvSource(sessionDir: string): boolean {
  if (process.env.CLAUDE_ENV_FILE && existsSync(process.env.CLAUDE_ENV_FILE)) return true
  try {
    return readdirSync(hookEnvDir(sessionDir)).some((name) => name.endsWith('.sh') && name.includes('-hook-'))
  } catch {
    return false
  }
}

export function shellSourceHookEnvSnippet(sessionDir: string): string {
  const dir = hookEnvDir(sessionDir).replaceAll("'", `'\\''`)
  return `if [ -n "\${CLAUDE_ENV_FILE:-}" ] && [ -f "$CLAUDE_ENV_FILE" ]; then . "$CLAUDE_ENV_FILE"; fi; if [ -d '${dir}' ]; then for __studio_env_file in '${dir}'/*-hook-*.sh; do [ -f "$__studio_env_file" ] && . "$__studio_env_file"; done; unset __studio_env_file; fi;`
}
