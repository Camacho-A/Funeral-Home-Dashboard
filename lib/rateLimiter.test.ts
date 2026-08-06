import { afterEach, describe, expect, it } from 'vitest';
import { checkRateLimit, resetRateLimiter } from './rateLimiter';

afterEach(() => {
  resetRateLimiter();
});

describe('checkRateLimit', () => {
  it('allows requests up to the limit, then denies', () => {
    const now = 1_000_000;
    expect(checkRateLimit('key-1', 3, 60_000, now).allowed).toBe(true);
    expect(checkRateLimit('key-1', 3, 60_000, now).allowed).toBe(true);
    expect(checkRateLimit('key-1', 3, 60_000, now).allowed).toBe(true);
    const fourth = checkRateLimit('key-1', 3, 60_000, now);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets the window after windowMs elapses', () => {
    const now = 1_000_000;
    checkRateLimit('key-2', 1, 1000, now);
    expect(checkRateLimit('key-2', 1, 1000, now).allowed).toBe(false);
    expect(checkRateLimit('key-2', 1, 1000, now + 1001).allowed).toBe(true);
  });

  it('scopes limits independently per key', () => {
    const now = 1_000_000;
    checkRateLimit('key-a', 1, 60_000, now);
    expect(checkRateLimit('key-a', 1, 60_000, now).allowed).toBe(false);
    expect(checkRateLimit('key-b', 1, 60_000, now).allowed).toBe(true);
  });

  it('reports decreasing remaining counts', () => {
    const now = 1_000_000;
    expect(checkRateLimit('key-3', 5, 60_000, now).remaining).toBe(4);
    expect(checkRateLimit('key-3', 5, 60_000, now).remaining).toBe(3);
  });
});
