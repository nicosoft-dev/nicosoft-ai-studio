// Optional structured-output contract for one-shot sub-agent delegations (Task / agent_batch). When the
// caller passes outputSchema, the child is told to return ONLY a JSON value of that shape, and the reply is
// validated as JSON — so the parent (or downstream code) gets a machine-readable result instead of prose,
// with a clear, non-silent note when the child misses the contract. Scoped to one-shots: persistent
// agent_spawn stays conversational (a single schema can't describe its stream of replies).

const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/

// Append the output-format directive to a child prompt when a schema was requested.
export function withJsonDirective(prompt: string, outputSchema?: string): string {
  if (!outputSchema?.trim()) return prompt
  return (
    `${prompt}\n\n` +
    `OUTPUT FORMAT — your FINAL message must be a single JSON value matching this shape, with NO prose, ` +
    `commentary, or markdown fences:\n${outputSchema.trim()}`
  )
}

// A stronger nudge for the one retry, when the first reply was not valid JSON.
export function jsonRetryDirective(outputSchema: string): string {
  return (
    `Your previous reply was NOT valid JSON. Reply with ONLY the JSON value matching this shape — no prose, ` +
    `no commentary, no markdown fences:\n${outputSchema.trim()}`
  )
}

// Validate a child reply against the requested schema (parse-only — shape is the model's responsibility,
// like the rest of the agent's model-tolerant inputs). Returns the compact JSON on success.
export function parseJsonReply(text: string): { ok: boolean; json?: string } {
  const stripped = text.trim().replace(FENCE, '$1').trim()
  try {
    return { ok: true, json: JSON.stringify(JSON.parse(stripped)) }
  } catch {
    return { ok: false }
  }
}

// Final shape for a reply when a schema was requested: the compact JSON, or the raw reply prefixed with a
// clear note (never silently pass prose where JSON was contracted — the parent can re-delegate).
export function asStructuredResult(reply: string, outputSchema?: string): string {
  if (!outputSchema?.trim()) return reply
  const parsed = parseJsonReply(reply)
  return parsed.ok ? (parsed.json as string) : `[sub-agent did not return valid JSON for the requested shape]\n${reply}`
}
