import { create } from 'zustand'

/* Global switch for the Memory Live overlay (the full-screen 3D "memory cloud"). Lifted out of the
   settings page's local state so the overlay can be opened from anywhere — the composer slash command
   (`/memory`) and the settings "Live" button drive the same single switch, and App mounts one overlay
   at the top level (z 300) so it floats above whatever view is active. MemoryLive is self-contained
   (it fetches its own pool via window.api.memory.list), so this store only carries the open flag. */
interface MemoryCloudState {
  open: boolean
  show: () => void
  hide: () => void
}

export const useMemoryCloud = create<MemoryCloudState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false })
}))
