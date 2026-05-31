import { create } from 'zustand'
import type { MemoryDto } from '@/lib/api'

// Renderer-side memory store: the flat list of stored memories + per-role self-learning flags (from
// role_states). All reads/writes go through window.api; the backend owns extraction + dedup. Memories
// are produced by the backend extractor — the UI only views, edits, and deletes them, plus toggles a
// role's self-learning.
interface MemoryState {
  memories: MemoryDto[]
  selfLearning: Record<string, boolean> // roleId → self-learning enabled (default true when absent)
  loaded: boolean
  load: () => Promise<void>
  update: (id: string, content: string) => Promise<void>
  remove: (id: string) => Promise<void>
  setSelfLearning: (roleId: string, on: boolean) => Promise<void>
}

export const useMemory = create<MemoryState>((set) => ({
  memories: [],
  selfLearning: {},
  loaded: false,

  load: async () => {
    const [memories, states] = await Promise.all([window.api.memory.list(), window.api.roles.listStates()])
    const selfLearning: Record<string, boolean> = {}
    for (const s of states) selfLearning[s.roleId] = s.selfLearningEnabled
    set({ memories, selfLearning, loaded: true })
  },

  update: async (id, content) => {
    await window.api.memory.update({ id, content })
    set((st) => ({ memories: st.memories.map((m) => (m.id === id ? { ...m, content } : m)) }))
  },

  remove: async (id) => {
    await window.api.memory.remove(id)
    set((st) => ({ memories: st.memories.filter((m) => m.id !== id) }))
  },

  // self-learning lives in role_states; patch only that column so the role's enabled flag is untouched.
  setSelfLearning: async (roleId, on) => {
    await window.api.roles.setState(roleId, { selfLearningEnabled: on })
    set((st) => ({ selfLearning: { ...st.selfLearning, [roleId]: on } }))
  }
}))
