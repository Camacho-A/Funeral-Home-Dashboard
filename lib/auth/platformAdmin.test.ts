import { afterEach, describe, expect, it } from 'vitest';
import { getPlatformAdminUserIds, isPlatformAdminUser } from './platformAdmin';

afterEach(() => {
  delete process.env.PLATFORM_ADMIN_USER_IDS;
});

describe('getPlatformAdminUserIds / isPlatformAdminUser', () => {
  it('returns an empty list when unset — safe default, no one is a platform admin', () => {
    expect(getPlatformAdminUserIds()).toEqual([]);
    expect(isPlatformAdminUser('mock-user-dana')).toBe(false);
  });

  it('parses a comma-separated allowlist, trimming whitespace', () => {
    process.env.PLATFORM_ADMIN_USER_IDS = ' mock-user-dana , mock-user-other ';
    expect(getPlatformAdminUserIds()).toEqual(['mock-user-dana', 'mock-user-other']);
    expect(isPlatformAdminUser('mock-user-dana')).toBe(true);
    expect(isPlatformAdminUser('mock-user-other')).toBe(true);
  });

  it('rejects a user id not on the allowlist', () => {
    process.env.PLATFORM_ADMIN_USER_IDS = 'mock-user-dana';
    expect(isPlatformAdminUser('mock-user-someone-else')).toBe(false);
  });

  it('ignores empty entries from stray commas', () => {
    process.env.PLATFORM_ADMIN_USER_IDS = 'mock-user-dana,,  ,mock-user-other';
    expect(getPlatformAdminUserIds()).toEqual(['mock-user-dana', 'mock-user-other']);
  });
});
