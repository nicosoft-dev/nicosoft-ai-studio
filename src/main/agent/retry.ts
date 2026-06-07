// Transient-failure retry policy for upstream LLM requests. A request that fails on a recoverable
// condition (network drop / idle-timeout abort, rate limit, or a 5xx / overloaded upstream) is retried
// with exponential backoff + full jitter, honoring an upstream Retry-After when present. Non-recoverable
// failures (bad key, forbidden, bad request) propagate immediately. The caller owns the attempt budget
// and surfaces a "retrying (N/M)" status to the UI.
import { LlmError } from '../llm/types'

// Default code-based retryability, used when an error carries no explicit decision. `network` also covers
// an idle-timeout abort on a hung upstream (mapped in _shared.toLlmError). bad_key / forbidden /
// bad_request are caller/auth errors — retrying is pointless.
const RETRYABLE = new Set(['network', 'rate_limited', 'upstream'])

// An explicit `retryable` (set by throwHttpError from the HTTP status + `x-should-retry` header) wins;
// it covers 408/409 and server-directed retry hints that the coarse code taxonomy can't express. When
// absent (e.g. a thrown network error), fall back to the code set.
export function isRetryableLlmError(err: unknown): err is LlmError {
  return err instanceof LlmError && (err.retryable ?? RETRYABLE.has(err.code))
}

const BASE_MS = 1_000
const CAP_MS = 32_000
const RETRY_AFTER_CAP_MS = 60_000

// Backoff for the Nth attempt (1-based): Retry-After wins when the upstream sent one; otherwise
// exponential (1s, 2s, 4s … capped at 32s) with full jitter (50–100%) to avoid thundering-herd retries.
export function retryBackoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, RETRY_AFTER_CAP_MS)
  const exp = Math.min(CAP_MS, BASE_MS * 2 ** (attempt - 1))
  return Math.round(exp * (0.5 + Math.random() * 0.5))
}

// A sleep that rejects the moment the run is aborted, so a user cancel during a long backoff stops at
// once instead of waiting out the timer.
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
