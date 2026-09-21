import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { portalUserFixtures } from '../__mocks__/portalFixtures';
import { hashPassword } from '../../lib/identity/passwordHashing';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `portal-user-test-${idCounter}`;
}

let originalLength: number;
beforeEach(() => {
  idCounter = 0;
  originalLength = portalUserFixtures.length;
});
afterEach(() => {
  portalUserFixtures.length = originalLength;
});

describe('portalUserService', () => {
  it('findOrCreatePortalUser creates a new portal user on first invitation acceptance', async () => {
    const { findOrCreatePortalUser } = await import('./portalUserService');
    const { portalUser, isNew } = await findOrCreatePortalUser(
      { email: 'family@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );

    expect(isNew).toBe(true);
    expect(portalUser.email).toBe('family@example.com');
    expect(portalUser.normalizedEmail).toBe('family@example.com');
    expect(portalUser.status).toBe('active');
  });

  it('findOrCreatePortalUser is idempotent by normalizedEmail — a second invitation acceptance reuses the same row', async () => {
    const { findOrCreatePortalUser } = await import('./portalUserService');
    const first = await findOrCreatePortalUser(
      { email: 'shared@example.com', displayName: 'Pat Family', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    const second = await findOrCreatePortalUser(
      { email: 'Shared@Example.com', displayName: 'Pat Family (again)', passwordHash: hashPassword('DifferentPassword1!'), idFactory },
      'mock',
    );

    expect(second.isNew).toBe(false);
    expect(second.portalUser.id).toBe(first.portalUser.id);
    // The original password is never overwritten by a second acceptance.
    expect(second.portalUser.passwordHash).toBe(first.portalUser.passwordHash);
  });

  it('getPortalUserById returns null for an unknown id', async () => {
    const { getPortalUserById } = await import('./portalUserService');
    expect(await getPortalUserById('no-such-user', 'mock')).toBeNull();
  });

  it('findPortalUserByEmail is case-insensitive', async () => {
    const { findOrCreatePortalUser, findPortalUserByEmail } = await import('./portalUserService');
    await findOrCreatePortalUser(
      { email: 'case.test@example.com', displayName: 'Case Test', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );
    expect(await findPortalUserByEmail('CASE.TEST@EXAMPLE.COM', 'mock')).not.toBeNull();
  });

  it('updatePortalUser patches only the given fields and bumps updatedAt', async () => {
    const { findOrCreatePortalUser, updatePortalUser } = await import('./portalUserService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'update.test@example.com', displayName: 'Update Test', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );

    const updated = await updatePortalUser(portalUser.id, { status: 'disabled' }, 'mock');
    expect(updated?.status).toBe('disabled');
    expect(updated?.email).toBe(portalUser.email);
  });

  it('updatePortalUser returns null for an unknown id', async () => {
    const { updatePortalUser } = await import('./portalUserService');
    expect(await updatePortalUser('no-such-user', { status: 'disabled' }, 'mock')).toBeNull();
  });

  it('requestPortalPasswordReset sets the token fields for an existing user and returns null for an unknown email', async () => {
    const { findOrCreatePortalUser, requestPortalPasswordReset } = await import('./portalUserService');
    await findOrCreatePortalUser(
      { email: 'reset.me@example.com', displayName: 'Reset Me', passwordHash: hashPassword('Password123!'), idFactory },
      'mock',
    );

    const updated = await requestPortalPasswordReset({ email: 'reset.me@example.com', tokenHash: 'a'.repeat(64), expiresAt: '2026-09-01T00:00:00.000Z' }, 'mock');
    expect(updated?.passwordResetTokenHash).toBe('a'.repeat(64));

    expect(await requestPortalPasswordReset({ email: 'no-such-email@example.com', tokenHash: 'b'.repeat(64), expiresAt: '2026-09-01T00:00:00.000Z' }, 'mock')).toBeNull();
  });

  it('resetPortalPasswordWithToken sets the new password and clears the token — never replayable', async () => {
    const { findOrCreatePortalUser, requestPortalPasswordReset, resetPortalPasswordWithToken, findPortalUserByPasswordResetTokenHash } = await import('./portalUserService');
    const { portalUser } = await findOrCreatePortalUser(
      { email: 'reset.consume@example.com', displayName: 'Reset Consume', passwordHash: hashPassword('OldPassword1!'), idFactory },
      'mock',
    );
    await requestPortalPasswordReset({ email: 'reset.consume@example.com', tokenHash: 'c'.repeat(64), expiresAt: '2026-09-01T00:00:00.000Z' }, 'mock');

    const updated = await resetPortalPasswordWithToken('c'.repeat(64), hashPassword('NewPassword1!'), 'mock');
    expect(updated?.id).toBe(portalUser.id);
    expect(updated?.passwordResetTokenHash).toBeNull();
    expect(updated?.passwordResetExpiresAt).toBeNull();

    // The consumed token can never be reused.
    expect(await findPortalUserByPasswordResetTokenHash('c'.repeat(64), 'mock')).toBeNull();
    expect(await resetPortalPasswordWithToken('c'.repeat(64), hashPassword('AnotherPassword1!'), 'mock')).toBeNull();
  });

  it('resetPortalPasswordWithToken rejects an expired token', async () => {
    const { findOrCreatePortalUser, requestPortalPasswordReset, resetPortalPasswordWithToken } = await import('./portalUserService');
    await findOrCreatePortalUser(
      { email: 'reset.expired@example.com', displayName: 'Reset Expired', passwordHash: hashPassword('OldPassword1!'), idFactory },
      'mock',
    );
    await requestPortalPasswordReset({ email: 'reset.expired@example.com', tokenHash: 'd'.repeat(64), expiresAt: '2020-01-01T00:00:00.000Z' }, 'mock');

    expect(await resetPortalPasswordWithToken('d'.repeat(64), hashPassword('NewPassword1!'), 'mock')).toBeNull();
  });

  it('resetPortalPasswordWithToken rejects an unknown token hash', async () => {
    const { resetPortalPasswordWithToken } = await import('./portalUserService');
    expect(await resetPortalPasswordWithToken('e'.repeat(64), hashPassword('NewPassword1!'), 'mock')).toBeNull();
  });

  /** Security correction (2026-09, Manors go-live): the Family Portal
      sibling of the staff-side active-only policy —
      `isPortalUserEligibleForPasswordReset`. A `disabled` portal user
      must not receive or redeem a reset link, and a token issued while
      active must fail closed if the user is disabled before redemption. */
  describe('active-only eligibility (Manors go-live security correction)', () => {
    it('requestPortalPasswordReset does not set token fields for a disabled portal user', async () => {
      const { findOrCreatePortalUser, updatePortalUser, requestPortalPasswordReset } = await import('./portalUserService');
      const { portalUser } = await findOrCreatePortalUser(
        { email: 'disabled.reset@example.com', displayName: 'Disabled Reset', passwordHash: hashPassword('Password123!'), idFactory },
        'mock',
      );
      await updatePortalUser(portalUser.id, { status: 'disabled' }, 'mock');

      const result = await requestPortalPasswordReset({ email: 'disabled.reset@example.com', tokenHash: 'f'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' }, 'mock');
      expect(result).toBeNull();
    });

    it('resetPortalPasswordWithToken rejects a valid, unexpired token whose user became disabled before redemption, and changes nothing', async () => {
      const { findOrCreatePortalUser, updatePortalUser, requestPortalPasswordReset, resetPortalPasswordWithToken, getPortalUserById } = await import('./portalUserService');
      const { portalUser } = await findOrCreatePortalUser(
        { email: 'becomes.disabled@example.com', displayName: 'Becomes Disabled', passwordHash: hashPassword('OldPassword1!'), idFactory },
        'mock',
      );
      await requestPortalPasswordReset({ email: 'becomes.disabled@example.com', tokenHash: 'a1'.repeat(32), expiresAt: '2030-01-01T00:00:00.000Z' }, 'mock');

      // Disabled AFTER the token was issued, before it's redeemed.
      await updatePortalUser(portalUser.id, { status: 'disabled' }, 'mock');

      const result = await resetPortalPasswordWithToken('a1'.repeat(32), hashPassword('NewPassword1!'), 'mock');
      expect(result).toBeNull();

      const unchanged = await getPortalUserById(portalUser.id, 'mock');
      expect(unchanged?.passwordHash).toBe(portalUser.passwordHash);
      expect(unchanged?.status).toBe('disabled');
    });
  });
});
