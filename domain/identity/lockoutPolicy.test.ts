import { describe, expect, it } from 'vitest';
import {
  MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT,
  isLockExpired,
  progressiveDelayMs,
  shouldLockAccount,
} from './lockoutPolicy';

describe('progressiveDelayMs', () => {
  it('has no delay for the first attempt', () => {
    expect(progressiveDelayMs(0)).toBe(0);
    expect(progressiveDelayMs(1)).toBe(0);
  });

  it('increases with each subsequent failed attempt', () => {
    expect(progressiveDelayMs(2)).toBeGreaterThan(progressiveDelayMs(1));
    expect(progressiveDelayMs(3)).toBeGreaterThan(progressiveDelayMs(2));
  });

  it('caps the delay rather than growing unbounded', () => {
    expect(progressiveDelayMs(20)).toBe(progressiveDelayMs(30));
  });
});

describe('shouldLockAccount', () => {
  it('does not lock below the threshold', () => {
    expect(shouldLockAccount(MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT - 1)).toBe(false);
  });

  it('locks at or above the threshold', () => {
    expect(shouldLockAccount(MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT)).toBe(true);
    expect(shouldLockAccount(MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT + 5)).toBe(true);
  });
});

describe('isLockExpired', () => {
  it('is not expired immediately after locking', () => {
    const lockedAt = new Date().toISOString();
    expect(isLockExpired(lockedAt, Date.now())).toBe(false);
  });

  it('is expired after the lockout duration has passed', () => {
    const lockedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 minutes ago
    expect(isLockExpired(lockedAt, Date.now())).toBe(true);
  });
});
