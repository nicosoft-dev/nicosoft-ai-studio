import { create } from 'zustand'

// Per-expert working directory. A single role's conversation/agent keeps its own cwd — finding one
// independent expert is NOT shared (only the future coordinator dispatching a multi-agent task shares
// one workspace). The path bar above each composer reads/writes this role's entry. Persisted to
// localStorage so it survives reloads.
interface WorkspaceState {
  cwdByExpert: Record<string, string>
  setCwd: (expertId: string, cwd: string) => void
}

const LS_KEY = 'nicosoft-studio-cwd-by-expert'
const initial = ((): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
})()

export const useWorkspace = create<WorkspaceState>((set) => ({
  cwdByExpert: initial,
  setCwd: (expertId, cwd) =>
    set((s) => {
      const next = { ...s.cwdByExpert, [expertId]: cwd }
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return { cwdByExpert: next }
    })
}))
