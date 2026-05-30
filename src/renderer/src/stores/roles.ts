import { create } from 'zustand'

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
  remove: (id) =>
    set((s) => ({ deleted: [...s.deleted, id], disabled: s.disabled.filter((x) => x !== id) }))
}))
