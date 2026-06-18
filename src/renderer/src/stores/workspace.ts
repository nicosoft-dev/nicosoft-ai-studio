import { create } from 'zustand'
import type { AgentMode } from '@/lib/agent-mode'

// Per-expert working directory + agent permission mode. A single role's conversation/agent keeps its
// own cwd and mode — finding one independent expert is NOT shared (only the future coordinator
// dispatching a multi-agent task shares one workspace). The path bar + mode picker above each composer
// read/write this role's entries. Persisted to localStorage so they survive reloads.
interface WorkspaceState {
  cwdByExpert: Record<string, string>
  setCwd: (expertId: string, cwd: string) => void
  modeByExpert: Record<string, AgentMode>
  setMode: (expertId: string, mode: AgentMode) => void
  // Files panel: which folders are expanded, keyed by root cwd — so the tree restores its open state when
  // you reopen the panel / switch back to a project.
  expandedByCwd: Record<string, string[]>
  setExpandedForCwd: (cwd: string, expanded: string[]) => void
}

const LS_KEY = 'nicosoft-studio-cwd-by-expert'
const MODE_KEY = 'nicosoft-studio-mode-by-expert'
const EXPANDED_KEY = 'nicosoft-studio-files-expanded'
function load<T>(key: string): Record<string, T> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, T>
  } catch {
    return {}
  }
}
function persist(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  cwdByExpert: load<string>(LS_KEY),
  setCwd: (expertId, cwd) =>
    set((s) => {
      const next = { ...s.cwdByExpert, [expertId]: cwd }
      persist(LS_KEY, next)
      return { cwdByExpert: next }
    }),
  modeByExpert: load<AgentMode>(MODE_KEY),
  setMode: (expertId, mode) =>
    set((s) => {
      const next = { ...s.modeByExpert, [expertId]: mode }
      persist(MODE_KEY, next)
      return { modeByExpert: next }
    }),
  expandedByCwd: load<string[]>(EXPANDED_KEY),
  setExpandedForCwd: (cwd, expanded) =>
    set((s) => {
      const next = { ...s.expandedByCwd, [cwd]: expanded }
      persist(EXPANDED_KEY, next)
      return { expandedByCwd: next }
    })
}))
