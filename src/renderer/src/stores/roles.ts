import { create } from 'zustand'
import { useChat } from './chat'
import { useMemory } from './memory'

// Role enable/disable/delete store (prototype: Mercury starts disabled).
// Atlas (coordinator) is the permanent PRIMARY role and can never be disabled.
// Shared across sidebar, mentions, Studio team. Built-ins disable-only; custom roles deletable.
interface RolesState {
  disabled: string[]
  deleted: string[]
  isDisabled: (id: string) => boolean
  isDeleted: (id: string) => boolean
  toggle: (id: string) => void
  enable: (id: string) => void
  disable: (id: string) => void
  remove: (id: string) => void
}

export const useRoles = create<RolesState>((set, get) => ({
  disabled: ['mercury'],
  deleted: [],
  isDisabled: (id) => get().disabled.includes(id),
  isDeleted: (id) => get().deleted.includes(id),
  toggle: (id) => {
    if (id === 'atlas') return
    set((s) => ({
      disabled: s.disabled.includes(id) ? s.disabled.filter((x) => x !== id) : [...s.disabled, id]
    }))
  },
  enable: (id) => set((s) => ({ disabled: s.disabled.filter((x) => x !== id) })),
  disable: (id) => {
    if (id === 'atlas') return
    set((s) => (s.disabled.includes(id) ? s : { disabled: [...s.disabled, id] }))
  },
  remove: (id) => {
    // Backend cascade: role-layer memories + the role's conversations (messages/summaries via FK) +
    // bindings + state + custom-role row. Shared memory is kept. Refresh the history + memory views
    // once it lands so deleted conversations/memories disappear.
    void window.api.roles.remove(id).then(
      () => {
        void useChat.getState().loadConversations()
        void useMemory.getState().load()
      },
      () => set((s) => ({ deleted: s.deleted.filter((x) => x !== id) })) // rollback the optimistic hide on failure
    )
    set((s) => ({ deleted: [...s.deleted, id], disabled: s.disabled.filter((x) => x !== id) }))
  }
}))
