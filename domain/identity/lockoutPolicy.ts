/**
 * Phase 21 (Identity, Authentication & Session Management). Pure
 * brute-force/lockout policy — takes a failed-attempt count (already
 * resolved by the caller from real login-activity records) and decides
 * how long to delay and whether to lock. No I/O, no organizationId — see
 * `services/identityService.ts`'s `recordFailedLogin`/`checkLoginAllowed`
 * for the stateful side.
 */
export const MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const FAILED_ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // only attempts within this window count toward lockout
const MAX_PROGRESSIVE_DELAY_MS = 5_000;

/** Doubles per attempt after the first, capped — a genuine deterrent
    without ever blocking a legitimate retry indefinitely on its own
    (lockout, below, is the hard stop). */
export function progressiveDelayMs(failedAttemptCount: number): number {
  if (failedAttemptCount <= 1) return 0;
  const delay = 2 ** (failedAttemptCount - 1) * 200;
  return Math.min(delay, MAX_PROGRESSIVE_DELAY_MS);
}

export function shouldLockAccount(failedAttemptCountInWindow: number): boolean {
  return failedAttemptCountInWindow >= MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT;
}

/** Given the timestamp an account was locked, whether that lock has
    naturally expired — a lock is not a one-way trip requiring manual
    intervention. */
export function isLockExpired(lockedAt: string, now: number = Date.now()): boolean {
  return now - new Date(lockedAt).getTime() >= LOCKOUT_DURATION_MS;
}
