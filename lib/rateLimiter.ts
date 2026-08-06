/**
 * Phase 29 (Family Portal & External Collaboration). A genuinely new
 * investment for this codebase — staff login has no rate limiting today
 * (see docs/AUTHENTICATION.md's own Known Limitations section), and that
 * gap is not silently repeated for a new public-facing surface
 * (refinement #13). A simple, in-memory, sliding-window bounded counter
 * keyed by an arbitrary string (e.g. `${ip}:${email}` for login/invitation
 * acceptance, `${portalUserId}:${caseId}` for message-send/payment-checkout).
 *
 * Deliberately process-local, matching this codebase's existing
 * "in-memory mock fixtures" precedent — there is no Redis or other
 * shared-state store anywhere in this codebase to back a durable,
 * multi-instance limiter, and adding one is out of scope for this phase.
 * A single-process deployment (this codebase's only deployment target
 * today) gets a real, working limit; a future multi-instance deployment
 * would need a shared-store-backed replacement, named here rather than
 * silently assumed away.
 */
type Bucket = { count: number; windowStartedAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterMs: number };

/** `key` scopes the limit (e.g. `login:{ip}:{normalizedEmail}`). `limit`
    attempts are allowed per `windowMs`; the window resets entirely once
    it elapses (fixed window, not a rolling one — simple and sufficient
    for a deterrent, not a precision billing meter). */
export function checkRateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartedAt >= windowMs) {
    buckets.set(key, { count: 1, windowStartedAt: now });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - existing.windowStartedAt) };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterMs: 0 };
}

/** Test-only reset — mirrors every other `services/__mocks__/*Fixtures.ts`
    file's own "clear between tests" convention. */
export function resetRateLimiter(): void {
  buckets.clear();
}
