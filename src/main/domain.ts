// Domain-level shared types — the lowest layer. repos / llm / ipc all depend on this, so none of
// them has to cross-depend on another. Keep it free of logic and runtime imports (types only).

export type Protocol = 'openai' | 'anthropic' | 'gemini' | 'custom'
