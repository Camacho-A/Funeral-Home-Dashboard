import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { identityFixtures, passwordResetTokenFixtures } from './__mocks__/identityFixtures';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `pw-test-${idCounter}`;
}

let lengths: { identity: number; tokens: number };
beforeEach(() => {
  idCounter = 0;
  lengths = { identity: identityFixtures.length, tokens: passwordResetTokenFixtures.length };
});
afterEach(() => {
  identityFixtures.length = lengths.identity;
  passwordResetTokenFixtures.length = lengths.tokens;
});

/** A freshly-created identity is `status: 'pending'` (nothing has
    activated it yet) — every test in this file that exercises password
    reset/change needs a realistic `active` account, matching the new
    active-only eligibility policy (`isIdentityEligibleForPasswordReset`). */
async function seedIdentity(email: string) {
  const { findOrCreateIdentity, updateIdentity } = await import('./identityService');
  const { identity } = await findOrCreateIdentity({ email, displayName: 'Test User', idFactory }, 'mock');
  return (await updateIdentity(identity.id, { status: 'active' }, 'mock')) ?? identity;
}

describe('setPassword / verifyPassword', () => {
  it('sets a password and verifies it correctly', async () => {
    const { setPassword, verifyPassword } = await import('./passwordService');
    const identity = await seedIdentity('setpw@example.com');
    await setPassword(identity.id, 'MyStrongPassword1!', 'mock');
    expect(await verifyPassword(identity.id, 'MyStrongPassword1!', 'mock')).toBe(true);
    expect(await verifyPassword(identity.id, 'wrong', 'mock')).toBe(false);
  });

  it('increments passwordVersion every time the password changes', async () => {
    const { setPassword } = await import('./passwordService');
    const { getIdentityById } = await import('./identityService');
    const identity = await seedIdentity('version@example.com');
    expect(identity.passwordVersion).toBe(0);

    await setPassword(identity.id, 'First1!', 'mock');
    expect((await getIdentityById(identity.id, 'mock'))?.passwordVersion).toBe(1);

    await setPassword(identity.id, 'Second1!', 'mock');
    expect((await getIdentityById(identity.id, 'mock'))?.passwordVersion).toBe(2);
  });
});

describe('changePassword', () => {
  it('succeeds when the current password is correct', async () => {
    const { setPassword, changePassword, verifyPassword } = await import('./passwordService');
    const identity = await seedIdentity('change@example.com');
    await setPassword(identity.id, 'Original1!', 'mock');

    const result = await changePassword(identity.id, 'Original1!', 'NewOne1!', 'mock');
    expect(result.success).toBe(true);
    expect(await verifyPassword(identity.id, 'NewOne1!', 'mock')).toBe(true);
  });

  it('fails and leaves the password unchanged when the current password is wrong', async () => {
    const { setPassword, changePassword, verifyPassword } = await import('./passwordService');
    const identity = await seedIdentity('changefail@example.com');
    await setPassword(identity.id, 'Original1!', 'mock');

    const result = await changePassword(identity.id, 'WrongCurrent', 'NewOne1!', 'mock');
    expect(result.success).toBe(false);
    expect(await verifyPassword(identity.id, 'Original1!', 'mock')).toBe(true);
  });
});

describe('createPasswordResetToken / resetPasswordWithToken', () => {
  it('resets the password with a valid token', async () => {
    const { setPassword, createPasswordResetToken, resetPasswordWithToken, verifyPassword } = await import('./passwordService');
    const identity = await seedIdentity('reset@example.com');
    await setPassword(identity.id, 'Old1!', 'mock');

    const { token } = await createPasswordResetToken(identity.id, idFactory, 'mock');
    const result = await resetPasswordWithToken(token, 'BrandNew1!', 'mock');
    expect(result.success).toBe(true);
    expect(await verifyPassword(identity.id, 'BrandNew1!', 'mock')).toBe(true);
  });

  it('is single-use — the same token cannot reset the password twice', async () => {
    const { setPassword, createPasswordResetToken, resetPasswordWithToken } = await import('./passwordService');
    const identity = await seedIdentity('singleuse@example.com');
    await setPassword(identity.id, 'Old1!', 'mock');
    const { token } = await createPasswordResetToken(identity.id, idFactory, 'mock');

    const first = await resetPasswordWithToken(token, 'First1!', 'mock');
    expect(first.success).toBe(true);
    const second = await resetPasswordWithToken(token, 'Second1!', 'mock');
    expect(second.success).toBe(false);
    if (!second.success) expect(second.reason).toBe('already_used');
  });

  it('rejects an expired token', async () => {
    const { setPassword, createPasswordResetToken, resetPasswordWithToken } = await import('./passwordService');
    const identity = await seedIdentity('expired@example.com');
    await setPassword(identity.id, 'Old1!', 'mock');
    const { token } = await createPasswordResetToken(identity.id, idFactory, 'mock');

    // Force the stored token to already be expired.
    const record = passwordResetTokenFixtures.find((t) => t.identityId === identity.id)!;
    record.expiresAt = new Date(Date.now() - 1000).toISOString();

    const result = await resetPasswordWithToken(token, 'New1!', 'mock');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('expired_token');
  });

  it('rejects a completely invalid/forged token', async () => {
    const { resetPasswordWithToken } = await import('./passwordService');
    const result = await resetPasswordWithToken('forged-token-value', 'New1!', 'mock');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('invalid_token');
  });

  /** Security correction (2026-09, Manors go-live): a validly-issued,
      unexpired, unused token must still fail closed if the identity it
      belongs to is no longer `active` at the moment of redemption — the
      token proves the holder controlled the inbox at issuance time, not
      that the account is still eligible right now. */
  describe('consumption-time revalidation — the identity must still be active at redemption, not just at issuance', () => {
    it('valid token whose identity becomes locked before redemption → rejected, password unchanged', async () => {
      const { setPassword, createPasswordResetToken, resetPasswordWithToken, verifyPassword } = await import('./passwordService');
      const { updateIdentity } = await import('./identityService');
      const identity = await seedIdentity('becomes-locked@example.com');
      await setPassword(identity.id, 'Original1!', 'mock');
      const { token } = await createPasswordResetToken(identity.id, idFactory, 'mock');

      // The account is locked out (e.g. brute-force protection) AFTER the
      // token was issued, but before it's redeemed.
      await updateIdentity(identity.id, { status: 'locked' }, 'mock');

      const result = await resetPasswordWithToken(token, 'AttemptedNew1!', 'mock');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.reason).toBe('identity_not_eligible');
      expect(await verifyPassword(identity.id, 'Original1!', 'mock')).toBe(true);
      expect(await verifyPassword(identity.id, 'AttemptedNew1!', 'mock')).toBe(false);
    });

    it('valid token whose identity becomes disabled before redemption → rejected, password unchanged', async () => {
      const { setPassword, createPasswordResetToken, resetPasswordWithToken, verifyPassword } = await import('./passwordService');
      const { updateIdentity } = await import('./identityService');
      const identity = await seedIdentity('becomes-disabled@example.com');
      await setPassword(identity.id, 'Original1!', 'mock');
      const { token } = await createPasswordResetToken(identity.id, idFactory, 'mock');

      await updateIdentity(identity.id, { status: 'disabled' }, 'mock');

      const result = await resetPasswordWithToken(token, 'AttemptedNew1!', 'mock');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.reason).toBe('identity_not_eligible');
      expect(await verifyPassword(identity.id, 'Original1!', 'mock')).toBe(true);
    });

    it('valid token whose identity becomes deleted before redemption → rejected, password unchanged', async () => {
      const { setPassword, createPasswordResetToken, resetPasswordWithToken, verifyPassword } = await import('./passwordService');
      const { updateIdentity } = await import('./identityService');
      const identity = await seedIdentity('becomes-deleted@example.com');
      await setPassword(identity.id, 'Original1!', 'mock');
      const { token } = await createPasswordResetToken(identity.id, idFactory, 'mock');

      await updateIdentity(identity.id, { status: 'deleted' }, 'mock');

      const result = await resetPasswordWithToken(token, 'AttemptedNew1!', 'mock');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.reason).toBe('identity_not_eligible');
      expect(await verifyPassword(identity.id, 'Original1!', 'mock')).toBe(true);
    });

    it('a rejected (ineligible-identity) redemption does not mark the token used — it stays available if the identity becomes active again before it expires', async () => {
      const { setPassword, createPasswordResetToken, resetPasswordWithToken, verifyPassword } = await import('./passwordService');
      const { updateIdentity } = await import('./identityService');
      const identity = await seedIdentity('temporarily-locked@example.com');
      await setPassword(identity.id, 'Original1!', 'mock');
      const { token } = await createPasswordResetToken(identity.id, idFactory, 'mock');

      await updateIdentity(identity.id, { status: 'locked' }, 'mock');
      const rejected = await resetPasswordWithToken(token, 'ShouldNotApply1!', 'mock');
      expect(rejected.success).toBe(false);

      // The lock clears (e.g. it naturally expired) — the same, still-valid
      // token is honored on a later attempt, since it was never burned.
      await updateIdentity(identity.id, { status: 'active' }, 'mock');
      const result = await resetPasswordWithToken(token, 'NowApplies1!', 'mock');
      expect(result.success).toBe(true);
      expect(await verifyPassword(identity.id, 'NowApplies1!', 'mock')).toBe(true);
    });
  });
});
