// Domain-level shared types — the lowest layer. repos / llm / ipc all depend on this, so none of
// them has to cross-depend on another. Keep it free of logic and runtime imports (types only).

export type Protocol = 'openai' | 'anthropic' | 'gemini' | 'custom'

// A model an endpoint serves: its slug + context window length in tokens. contextLength 0 = unknown.
export interface ModelInfo {
  slug: string
  contextLength: number
}
