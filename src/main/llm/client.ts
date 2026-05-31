// Unified LLM entry point. Dispatches by req.protocol to the matching adapter. `custom` is treated
// as OpenAI-compatible (Responses API). Adapters are pure protocol translators; this module adds no
// DB / keychain access — the apiKey arrives on the request from the calling service.

import type { ChatFn, ChatRequest, ChatResult, OnDelta } from './types'
import { chatOpenAI } from './openai'
import { chatAnthropic } from './anthropic'
import { chatGemini } from './gemini'

export const chat: ChatFn = (req: ChatRequest, onDelta: OnDelta): Promise<ChatResult> => {
  switch (req.protocol) {
    case 'anthropic':
      return chatAnthropic(req, onDelta)
    case 'gemini':
      return chatGemini(req, onDelta)
    case 'openai':
    case 'custom':
      return chatOpenAI(req, onDelta)
    default: {
      // Exhaustiveness guard: a new Protocol member must be wired explicitly.
      const _never: never = req.protocol
      return Promise.reject(new Error(`unsupported protocol: ${String(_never)}`))
    }
  }
}
