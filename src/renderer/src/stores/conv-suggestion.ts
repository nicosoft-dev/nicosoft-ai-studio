/* ============================================================
   Ghost prompt suggestion per conversation — retained app-wide.
   Main pushes one suggestion after a turn settles (conv:suggestion, empty text clears). Subscribing at
   module load (app lifetime, same rationale as conv-async) keeps the latest suggestion for EVERY
   conversation, so switching back to a conversation still shows its ghost. The composer clears the local
   entry when the user sends or dismisses (Escape) — main only overwrites on the next settle.
   ============================================================ */
import { create } from 'zustand'

interface ConvSuggestionState {
  byConv: Record<string, string>
}

export const useConvSuggestion = create<ConvSuggestionState>(() => ({ byConv: {} }))

export function clearSuggestion(convId: string): void {
  useConvSuggestion.setState((s) => {
    if (!s.byConv[convId]) return s
    const next = { ...s.byConv }
    delete next[convId]
    return { byConv: next }
  })
}

// One app-lifetime subscription (never unsubscribed — it must outlive every composer mount/unmount).
window.api.onConvSuggestion((d) => {
  useConvSuggestion.setState((s) => {
    if (!d.text) {
      if (!s.byConv[d.convId]) return s
      const next = { ...s.byConv }
      delete next[d.convId]
      return { byConv: next }
    }
    return { byConv: { ...s.byConv, [d.convId]: d.text } }
  })
})
