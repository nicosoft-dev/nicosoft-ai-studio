// Protocol-agnostic LLM client types. Adapters (openai/anthropic/gemini) translate to each
// provider's native API; client.ts dispatches by protocol. Adapters are pure protocol
// translation — they never touch the DB or keychain (the key is passed in by the service).

import type { Protocol } from '../domain'
export type { Protocol }

export type LlmErrorCode =
  | 'bad_key' // 401
  | 'forbidden' // 403
  | 'rate_limited' // 429
  | 'upstream' // 5xx
  | 'bad_request' // 400
  | 'network' // fetch failed / aborted
  | 'unknown'

export class LlmError extends Error {
  code: LlmErrorCode
  status?: number
  constructor(code: LlmErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.status = status
  }
}

export interface ChatAttachment {
  type: 'image'
  url: string // data: URL or remote URL; adapter formats it per provider's vision schema
  mime?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  attachments?: ChatAttachment[]
}

export interface ChatRequest {
  protocol: Protocol
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  reasoning?: 'low' | 'medium' | 'high' // only sent for models that support it
  signal?: AbortSignal
}

export interface ChatUsage {
  inTokens: number
  outTokens: number
}

export interface ChatResult {
  text: string
  usage: ChatUsage
  model: string
}

// Streaming delta callback — invoked per token/chunk as text arrives.
export type OnDelta = (delta: { text: string }) => void

// Every adapter implements this exact shape.
export type ChatFn = (req: ChatRequest, onDelta: OnDelta) => Promise<ChatResult>
