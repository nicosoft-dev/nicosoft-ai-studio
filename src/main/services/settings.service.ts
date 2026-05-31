import * as settingRepo from '../repos/setting.repo'

// Thin business layer over the settings key/value table (profile / general / privacy).
// Kept as a service (not called straight from IPC) so later validation/defaults have a home.

export function get<T = unknown>(key: string): T | null {
  return settingRepo.get<T>(key)
}

export function set<T = unknown>(key: string, value: T): void {
  settingRepo.set<T>(key, value)
}
