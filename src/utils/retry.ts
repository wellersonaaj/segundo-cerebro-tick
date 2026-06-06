/**
 * Retry helper for transient failures.
 *
 * - maxAttempts: total attempts (default 3)
 * - baseDelayMs: starting backoff (default 1000ms; doubles each attempt: 1s, 2s, 4s)
 * - isRetryable: classify the error. Default retries timeout, 429, 5xx, network reset.
 *   Pass an explicit classifier for 4xx vs 5xx distinction (Telegram).
 * - onRetry: observability hook.
 *
 * IMPORTANT: This is infrastructure for resilience, NOT a content filter.
 * We do NOT add regex to fix LLM output — the LLM is the source of truth.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown, nextDelayMs: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryable(err)) {
        throw err;
      }
      const delay = baseDelayMs * 2 ** (attempt - 1);
      opts.onRetry?.(attempt, err, delay);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastErr;
}

function defaultIsRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();

  // OpenAI SDK timeouts
  if (msg.includes('timeout') || msg.includes('etimedout')) return true;

  // Rate limits
  if (msg.includes('429') || msg.includes('rate limit')) return true;

  // 5xx server errors
  if (
    msg.includes(' 500') ||
    msg.includes(' 502') ||
    msg.includes(' 503') ||
    msg.includes(' 504') ||
    msg.includes('internal server error') ||
    msg.includes('bad gateway') ||
    msg.includes('service unavailable') ||
    msg.includes('gateway timeout')
  ) {
    return true;
  }

  // Network errors
  if (
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('fetch failed')
  ) {
    return true;
  }

  return false;
}
