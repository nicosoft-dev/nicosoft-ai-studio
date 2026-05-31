// Google Gemini adapter (POST /v1beta/models/{model}:streamGenerateContent?alt=sse; key in header).
// System turns go to `systemInstruction`; user/assistant become contents with role user/model.
// With alt=sse the stream is line-delimited `data: {json}`; text is in candidates[0].content.parts,
// usage in usageMetadata (promptTokenCount / candidatesTokenCount).

import type { ChatAttachment, ChatFn, ChatMessage, ChatRequest, ChatResult, OnDelta } from './types'
import { iterSSE, openStream, parseJSON, toLlmError } from './_shared'

const PROVIDER = 'gemini'

interface TextPart {
  text: string
}
interface InlineDataPart {
  inlineData: { mimeType: string; data: string }
}
type Part = TextPart | InlineDataPart

interface Content {
  role: 'user' | 'model'
  parts: Part[]
}

interface GeminiBody {
  contents: Content[]
  systemInstruction?: { parts: TextPart[] }
}

// Build an inlineData part from an attachment. Gemini wants raw base64 (no data: prefix) plus mime.
function inlinePart(att: ChatAttachment): InlineDataPart | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(att.url)
  if (m) return { inlineData: { mimeType: m[1], data: m[2] } }
  if (att.url.startsWith('data:')) {
    // Non-base64 data URL: `data:<mime>[;...],<payload>` — split on the first comma.
    const comma = att.url.indexOf(',')
    const semi = att.url.indexOf(';')
    const mimeEnd = semi === -1 || semi > comma ? comma : semi
    const mime = att.mime ?? att.url.slice('data:'.length, mimeEnd)
    return { inlineData: { mimeType: mime, data: att.url.slice(comma + 1) } }
  }
  // Gemini inlineData requires bytes; a bare remote URL cannot be inlined here. Skip it rather than
  // send an invalid part. (File API upload is out of scope for this translation layer.)
  return null
}

function toContents(messages: ChatMessage[]): Content[] {
  const out: Content[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    const parts: Part[] = []
    for (const att of m.attachments ?? []) {
      const p = inlinePart(att)
      if (p) parts.push(p)
    }
    if (m.content) parts.push({ text: m.content })
    if (parts.length === 0) parts.push({ text: '' })
    out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts })
  }
  return out
}

function toSystemInstruction(messages: ChatMessage[]): { parts: TextPart[] } | undefined {
  const texts = messages.filter((m) => m.role === 'system' && m.content).map((m) => m.content)
  return texts.length > 0 ? { parts: texts.map((t) => ({ text: t })) } : undefined
}

function buildBody(req: ChatRequest): GeminiBody {
  const body: GeminiBody = { contents: toContents(req.messages) }
  const sys = toSystemInstruction(req.messages)
  if (sys) body.systemInstruction = sys
  return body
}

interface GeminiPart {
  text?: string
}
interface GeminiChunk {
  candidates?: { content?: { parts?: GeminiPart[] } }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

// Concatenate all part texts across candidates in one chunk.
function chunkText(chunk: GeminiChunk): string {
  let s = ''
  for (const c of chunk.candidates ?? []) {
    for (const p of c.content?.parts ?? []) {
      if (typeof p.text === 'string') s += p.text
    }
  }
  return s
}

export const chatGemini: ChatFn = async (req: ChatRequest, onDelta: OnDelta): Promise<ChatResult> => {
  const base = req.baseUrl.replace(/\/$/, '').replace(/\/v1beta$/, '').replace(/\/v1$/, '')
  // Key goes in the x-goog-api-key header, not the URL — query-string secrets are more likely to
  // land in logs/proxies/crash dumps.
  const url = `${base}/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`
  const reader = await openStream(PROVIDER, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
    body: JSON.stringify(buildBody(req)),
    signal: req.signal,
  })

  let text = ''
  let inTokens = 0
  let outTokens = 0

  try {
    for await (const payload of iterSSE(reader)) {
      const chunk = parseJSON(payload) as GeminiChunk | null
      if (!chunk) continue
      const delta = chunkText(chunk)
      if (delta.length > 0) {
        text += delta
        onDelta({ text: delta })
      }
      const u = chunk.usageMetadata
      if (u) {
        // Each chunk reports cumulative totals; keep the latest non-zero values.
        if (typeof u.promptTokenCount === 'number' && u.promptTokenCount > 0) inTokens = u.promptTokenCount
        if (typeof u.candidatesTokenCount === 'number' && u.candidatesTokenCount > 0) outTokens = u.candidatesTokenCount
      }
    }
  } catch (err) {
    throw toLlmError(PROVIDER, err)
  }

  return { text, usage: { inTokens, outTokens }, model: req.model }
}
