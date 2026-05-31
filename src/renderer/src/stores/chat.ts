import { create } from 'zustand'
import { STUDIO_DATA } from '@/data/studio-data'
import type { EffortLevel } from '@/lib/thinking'

// Per-expert chat conversation store (L2 — real streaming over window.api.chat, in-memory; message/
// session persistence is a later iteration). Each role keeps its own message list, so switching roles
// preserves the conversation. One stream can be in flight per role; deltas route by streamId → expert.

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  images?: { url: string; name: string }[]
  streaming?: boolean
}

interface SendOpts {
  expertId: string
  endpointId: string
  model: string
  thinking?: { effort?: EffortLevel; budgetTokens?: number }
  text: string
  images?: { dataUrl: string; mime: string; name: string }[]
}

interface ChatState {
  byExpert: Record<string, ChatMessage[]>
  streaming: Record<string, boolean>
  error: Record<string, string | null>
  streamIds: Record<string, string>
  send: (opts: SendOpts) => Promise<void>
  stop: (expertId: string) => void
}

const uid = (): string => globalThis.crypto.randomUUID()
const streamExpert = new Map<string, string>() // streamId → expertId
let listening = false

export const useChat = create<ChatState>((set, get) => {
  // Wire the chat IPC listeners once. delta/done/error carry a streamId we map back to the expert
  // whose conversation it belongs to (multiple roles may have streamed during the session).
  const ensureListeners = (): void => {
    if (listening) return
    listening = true
    const api = window.api.chat
    api.onDelta((d) => {
      const eid = streamExpert.get(d.streamId)
      if (!eid) return
      set((s) => {
        const msgs = (s.byExpert[eid] ?? []).map((m) => ({ ...m }))
        const cur = msgs[msgs.length - 1]
        if (cur && cur.role === 'assistant' && cur.streaming) cur.text += d.text
        return { byExpert: { ...s.byExpert, [eid]: msgs } }
      })
    })
    api.onDone((d) => {
      const eid = streamExpert.get(d.streamId)
      streamExpert.delete(d.streamId)
      if (!eid) return
      set((s) => {
        const msgs = (s.byExpert[eid] ?? []).map((m) => ({ ...m }))
        const cur = msgs[msgs.length - 1]
        if (cur && cur.role === 'assistant') {
          cur.streaming = false
          cur.text = d.text // done is authoritative for the final text
        }
        return { byExpert: { ...s.byExpert, [eid]: msgs }, streaming: { ...s.streaming, [eid]: false } }
      })
    })
    api.onError((d) => {
      const eid = streamExpert.get(d.streamId)
      streamExpert.delete(d.streamId)
      if (!eid) return
      set((s) => {
        const msgs = (s.byExpert[eid] ?? []).filter((m) => !(m.role === 'assistant' && m.streaming))
        return {
          byExpert: { ...s.byExpert, [eid]: msgs },
          streaming: { ...s.streaming, [eid]: false },
          error: { ...s.error, [eid]: d.message }
        }
      })
    })
  }

  return {
    byExpert: {},
    streaming: {},
    error: {},
    streamIds: {},

    send: async ({ expertId, endpointId, model, thinking, text, images }) => {
      ensureListeners()
      const userImages = (images ?? []).map((i) => ({ url: i.dataUrl, name: i.name }))
      set((s) => {
        const prev = s.byExpert[expertId] ?? []
        return {
          byExpert: {
            ...s.byExpert,
            [expertId]: [
              ...prev,
              { id: uid(), role: 'user', text, images: userImages.length ? userImages : undefined },
              { id: uid(), role: 'assistant', text: '', streaming: true }
            ]
          },
          streaming: { ...s.streaming, [expertId]: true },
          error: { ...s.error, [expertId]: null }
        }
      })

      const expert = STUDIO_DATA.EXPERT_BY_ID[expertId]
      const system = expert ? `You are ${expert.name}, ${expert.specialty.toLowerCase()}. ${expert.personality}.` : ''
      const history = (get().byExpert[expertId] ?? []).filter((m) => !(m.role === 'assistant' && m.streaming))
      const messages = [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        ...history.map((m) => ({
          role: m.role,
          content: m.text,
          ...(m.images && m.images.length ? { attachments: m.images.map((img) => ({ url: img.url })) } : {})
        }))
      ]

      try {
        const { streamId } = await window.api.chat.send({ endpointId, model, messages, thinking })
        streamExpert.set(streamId, expertId)
        set((s) => ({ streamIds: { ...s.streamIds, [expertId]: streamId } }))
      } catch (e) {
        set((s) => {
          const msgs = (s.byExpert[expertId] ?? []).filter((m) => !(m.role === 'assistant' && m.streaming))
          return {
            byExpert: { ...s.byExpert, [expertId]: msgs },
            streaming: { ...s.streaming, [expertId]: false },
            error: { ...s.error, [expertId]: e instanceof Error ? e.message : String(e) }
          }
        })
      }
    },

    stop: (expertId) => {
      const id = get().streamIds[expertId]
      if (id) {
        void window.api.chat.stop(id)
        streamExpert.delete(id)
      }
      set((s) => ({ streaming: { ...s.streaming, [expertId]: false } }))
    }
  }
})
