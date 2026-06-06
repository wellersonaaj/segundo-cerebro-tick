import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../src/utils/retry.js';

describe('withRetry', () => {
  it('returns the value on first success without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error (timeout) and eventually succeeds', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        const e = new Error('OpenAI request timeout');
        throw e;
      }
      return 'recovered';
    });
    const onRetry = vi.fn();
    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      onRetry,
    });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts and throws the last error', async () => {
    const fn = vi.fn(async () => {
      throw new Error('OpenAI request timeout');
    });
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry non-retryable errors (4xx, validation)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('validation failed: bad input');
    });
    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 1 }),
    ).rejects.toThrow('validation');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries 429 rate limit', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) {
        throw new Error('openai 429 rate limit exceeded');
      }
      return 'ok';
    });
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries 5xx server errors', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) {
        throw new Error('openai 503 service unavailable');
      }
      return 'ok';
    });
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries network errors (fetch failed)', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) {
        throw new Error('fetch failed');
      }
      return 'ok';
    });
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
  });

  it('uses isRetryable custom classifier when provided', async () => {
    const fn = vi.fn(async () => {
      throw new Error('chat not found');
    });
    const isRetryable = vi.fn(() => false);
    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 1, isRetryable }),
    ).rejects.toThrow('chat not found');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isRetryable).toHaveBeenCalled();
  });

  it('applies exponential backoff (1s, 2s, 4s by default)', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw new Error('timeout');
    });
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 1000 });
    // attach catch to prevent unhandled rejection
    promise.catch(() => undefined);
    // First retry: 1s
    await vi.advanceTimersByTimeAsync(1000);
    // Second retry: 2s
    await vi.advanceTimersByTimeAsync(2000);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
