/* ============================================================
   Live async-handle list per conversation — retained app-wide.
   Main pushes the handle set on every launch / settle / stop (conv:async). Subscribing here, at module
   load (app lifetime), keeps the latest set for EVERY conversation even while the Tasks panel is closed —
   so opening the panel mid-run shows the current background ops right away (same rationale as
   conv-services). The panel itself filters to status:'running' — settled handles announce themselves via
   the resume injection in the transcript, not here.
   ============================================================ */
import { create } from 'zustand'
import type { AsyncHandleDto } from '@/lib/api'

interface ConvAsyncState {
  byConv: Record<string, AsyncHandleDto[]>
}

export const useConvAsync = create<ConvAsyncState>(() => ({ byConv: {} }))

// One app-lifetime subscription (never unsubscribed — it must outlive every Tasks-panel mount/unmount).
window.api.onConvAsync((d) => {
  useConvAsync.setState((s) => ({ byConv: { ...s.byConv, [d.convId]: d.handles } }))
})
