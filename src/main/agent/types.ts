// Agent-layer message + content-block types for the Hex coding agent. Richer than llm/types.ts's
// ChatMessage (plain text) — the agent loop needs tool_use / tool_result blocks to match the
// Anthropic tool-use wire. See docs/nicosoft-studio/12-hex-coding-agent.md §2.4.

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ImageSource {
  type: 'base64'
  media_type: string
  data: string
}

export interface ImageBlock {
  type: 'image'
  source: ImageSource
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  // A string, or an array of text/image blocks (images can't sit in an is_error result — push them
  // as sibling blocks instead, per the Anthropic API).
  content: string | Array<TextBlock | ImageBlock>
  is_error?: boolean
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'refusal' | null

export interface Usage {
  inTokens: number
  outTokens: number
}

// One full assistant turn from the LLM call, with tool_use blocks already assembled from the stream.
export interface AssistantTurn {
  content: Array<TextBlock | ToolUseBlock>
  stopReason: StopReason
  usage: Usage
}

// Anthropic `tools` param entry — name + description + JSON Schema (from zod-to-json-schema).
export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>
}
