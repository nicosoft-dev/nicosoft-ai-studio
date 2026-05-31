import type { Protocol } from '../domain'

// DTOs crossing the IPC boundary (handlers ↔ preload ↔ renderer). The renderer-facing Endpoint
// view carries `hasKey` (a boolean) but never the key itself — secrets stay in the keychain.

export interface EndpointDto {
  id: string
  name: string
  protocol: Protocol
  baseUrl: string
  defaultModel: string | null
  availableModels: string[]
  enabled: boolean
  hasKey: boolean
  createdAt: string
}

export interface EndpointInput {
  name: string
  protocol: Protocol
  baseUrl: string
  defaultModel?: string | null
  availableModels?: string[]
  enabled?: boolean
  apiKey?: string // written to the keychain, never stored in the table
}

export interface EndpointTestResult {
  ok: boolean
  error?: { code: string; message: string }
}

export interface ChatSendInput {
  endpointId: string
  model: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  reasoning?: 'low' | 'medium' | 'high'
}

// Streaming events pushed to the renderer over `chat:delta` / `chat:done` / `chat:error`.
export interface ChatDelta {
  streamId: string
  text: string
}
export interface ChatDone {
  streamId: string
  text: string
  usage: { inTokens: number; outTokens: number }
  model: string
}
export interface ChatErrorDto {
  streamId: string
  code: string
  message: string
}
