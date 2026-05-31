// Hex agent conversation store. Drives a real agent run over IPC (window.api.agent) and accumulates
// the streamed events into a renderable message list: text streams in via agent:delta, a finished
// turn's tool calls arrive via agent:assistant, their results via agent:results, and a tool needing
// approval surfaces as `permission` until the user answers. One run at a time.

import { create } from 'zustand'
import type { EffortLevel } from '@/lib/thinking'

export interface HexToolCall {
  id: string
  name: string
  input: unknown
  status: 'running' | 'done' | 'error'
  result?: string
}
export interface HexMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  images?: { url: string; name: string }[] // user-attached images (data URLs), shown in the bubble
  tools: HexToolCall[]
  streaming?: boolean
}
export interface PermissionPrompt {
  permissionId: string
  toolName: string
  input: unknown
  reason?: string
}

interface HexState {
  messages: HexMessage[]
  streaming: boolean
  streamId: string | null
  permission: PermissionPrompt | null
  error: string | null
  run: (opts: {
    endpointId: string
    model: string
    prompt: string
    thinking?: { effort?: EffortLevel; budgetTokens?: number }
    cwd: string
    images?: { dataUrl: string; mime: string; name: string }[]
    contextWindow?: number
  }) => Promise<void>
  respondPermission: (allow: boolean) => void
  stop: () => void
  reset: () => void
}

const uid = (): string => globalThis.crypto.randomUUID()
let unsubs: Array<() => void> = []
const teardown = (): void => {
  for (const u of unsubs) u()
  unsubs = []
}

export const useHex = create<HexState>((set, get) => ({
  messages: [],
  streaming: false,
  streamId: null,
  permission: null,
  error: null,

  run: async ({ endpointId, model, prompt, thinking, cwd, images, contextWindow }) => {
    if (!cwd) {
      set({ error: 'Set a working directory before running Hex.' })
      return
    }
    teardown()
    const userImages = (images ?? []).map((i) => ({ url: i.dataUrl, name: i.name }))
    set((s) => ({
      messages: [
        ...s.messages,
        { id: uid(), role: 'user', text: prompt, images: userImages.length ? userImages : undefined, tools: [] }
      ],
      streaming: true,
      error: null,
      permission: null,
    }))

    const api = window.api.agent

    // Ensure there's a streaming assistant message to append to; create one if the last isn't.
    const ensureStreamingAssistant = (msgs: HexMessage[]): HexMessage => {
      const last = msgs[msgs.length - 1]
      if (last && last.role === 'assistant' && last.streaming) return last
      const fresh: HexMessage = { id: uid(), role: 'assistant', text: '', tools: [], streaming: true }
      msgs.push(fresh)
      return fresh
    }

    unsubs.push(
      api.onDelta((d) => {
        set((s) => {
          const msgs = s.messages.map((m) => ({ ...m, tools: [...m.tools] }))
          const cur = ensureStreamingAssistant(msgs)
          cur.text += d.text
          return { messages: msgs }
        })
      }),
    )
    unsubs.push(
      api.onAssistant((d) => {
        set((s) => {
          const msgs = s.messages.map((m) => ({ ...m, tools: [...m.tools] }))
          const cur = ensureStreamingAssistant(msgs)
          const text = d.blocks
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map((b) => b.text)
            .join('')
          const tools: HexToolCall[] = d.blocks
            .filter((b): b is { type: 'tool_use'; id: string; name: string; input: unknown } => b.type === 'tool_use')
            .map((b) => ({ id: b.id, name: b.name, input: b.input, status: 'running' }))
          cur.text = text // onAssistant is authoritative for the turn's text (deltas were a preview)
          cur.tools = tools
          cur.streaming = false // turn complete; the next turn (after results) starts a new message
          return { messages: msgs }
        })
      }),
    )
    unsubs.push(
      api.onResults((d) => {
        set((s) => {
          const msgs = s.messages.map((m) => ({ ...m, tools: [...m.tools] }))
          // Apply each result to the MOST RECENT assistant message holding a running tool with that id
          // — scoping to the live turn avoids a synthetic-id collision cross-updating an older bubble.
          for (const r of d.results) {
            for (let i = msgs.length - 1; i >= 0; i--) {
              const idx = msgs[i].tools.findIndex((t) => t.id === r.toolUseId && t.status === 'running')
              if (idx !== -1) {
                msgs[i].tools[idx] = { ...msgs[i].tools[idx], status: r.isError ? 'error' : 'done', result: r.content }
                break
              }
            }
          }
          return { messages: msgs }
        })
      }),
    )
    unsubs.push(
      api.onPermission((d) => {
        set({ permission: { permissionId: d.permissionId, toolName: d.toolName, input: d.input, reason: d.reason } })
      }),
    )
    unsubs.push(
      api.onPermissionCancel((d) => {
        // a run/turn abort cancelled this prompt — drop the dialog if it's the one showing.
        set((s) => (s.permission?.permissionId === d.permissionId ? { permission: null } : {}))
      }),
    )
    unsubs.push(
      api.onDone(() => {
        set({ streaming: false, streamId: null, permission: null })
        teardown()
      }),
    )
    unsubs.push(
      api.onError((d) => {
        set({ streaming: false, streamId: null, error: d.message, permission: null })
        teardown()
      }),
    )

    const { streamId } = await api.run({
      endpointId,
      model,
      prompt,
      cwd,
      thinking,
      contextWindow,
      images: images?.map((i) => ({ dataUrl: i.dataUrl, mime: i.mime }))
    })
    set({ streamId })
  },

  respondPermission: (allow) => {
    const p = get().permission
    if (!p) return
    void window.api.agent.respondPermission({ permissionId: p.permissionId, allow })
    set({ permission: null })
  },

  stop: () => {
    const id = get().streamId
    if (id) void window.api.agent.stop(id)
    set({ streaming: false })
  },

  reset: () => {
    teardown()
    set({ messages: [], streaming: false, streamId: null, permission: null, error: null })
  },
}))
