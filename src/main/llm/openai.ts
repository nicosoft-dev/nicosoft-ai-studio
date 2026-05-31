// OpenAI Responses API adapter (POST /v1/responses, stream). NOT chat/completions.
// System prompts go to the top-level `instructions`; user/assistant turns become `input` items.
// SSE is event-based: `response.output_text.delta` carries text, `response.completed` carries usage.

import type { ChatAttachment, ChatFn, ChatMessage, ChatRequest, ChatResult, OnDelta } from './types'
import { iterSSE, openStream, parseJSON, toLlmError } from './_shared'

const PROVIDER = 'openai'

interface InputTextPart {
  type: 'input_text'
  text: string
}
interface InputImagePart {
  type: 'input_image'
  image_url: string
}
type InputPart = InputTextPart | InputImagePart

interface InputItem {
  role: 'user' | 'assistant'
  content: InputPart[]
}

interface ResponsesBody {
  model: string
  input: InputItem[]
  stream: true
  store: false
  instructions?: string
  reasoning?: { effort: 'low' | 'medium' | 'high' }
}

// Build `input` items from messages. System messages are not emitted here (hoisted to instructions).
// Each turn's text becomes an input_text part; image attachments become input_image parts.
function toInput(messages: ChatMessage[]): InputItem[] {
  const items: InputItem[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    const content: InputPart[] = []
    if (m.content) content.push({ type: 'input_text', text: m.content })
    for (const att of m.attachments ?? []) {
      content.push({ type: 'input_image', image_url: imageUrlOf(att) })
    }
    if (content.length === 0) content.push({ type: 'input_text', text: '' })
    items.push({ role: m.role, content })
  }
  return items
}

function imageUrlOf(att: ChatAttachment): string {
  // Responses accepts a data: URL or remote URL verbatim for input_image.
  return att.url
}

// Concatenate all system messages into a single instructions string (blank-line separated).
function toInstructions(messages: ChatMessage[]): string | undefined {
  const parts = messages.filter((m) => m.role === 'system' && m.content).map((m) => m.content)
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function buildBody(req: ChatRequest): ResponsesBody {
  const body: ResponsesBody = {
    model: req.model,
    input: toInput(req.messages),
    stream: true,
    store: false // local-first: don't let the provider retain responses server-side
  }
  const instructions = toInstructions(req.messages)
  if (instructions) body.instructions = instructions
  if (req.reasoning) body.reasoning = { effort: req.reasoning }
  return body
}

export const chatOpenAI: ChatFn = async (req: ChatRequest, onDelta: OnDelta): Promise<ChatResult> => {
  const url = `${req.baseUrl.replace(/\/$/, '')}/v1/responses`
  const reader = await openStream(PROVIDER, url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildBody(req)),
    signal: req.signal,
  })

  let text = ''
  let inTokens = 0
  let outTokens = 0

  try {
    for await (const payload of iterSSE(reader)) {
      const ev = parseJSON(payload) as
        | { type?: string; delta?: string; response?: { usage?: { input_tokens?: number; output_tokens?: number } } }
        | null
      if (!ev || typeof ev.type !== 'string') continue
      if (ev.type === 'response.output_text.delta') {
        if (typeof ev.delta === 'string' && ev.delta.length > 0) {
          text += ev.delta
          onDelta({ text: ev.delta })
        }
      } else if (ev.type === 'response.completed') {
        const u = ev.response?.usage
        if (u) {
          inTokens = u.input_tokens ?? 0
          outTokens = u.output_tokens ?? 0
        }
      }
    }
  } catch (err) {
    throw toLlmError(PROVIDER, err)
  }

  return { text, usage: { inTokens, outTokens }, model: req.model }
}
