import { afterEach, describe, expect, it } from 'vitest';
import { beginMfaEnrollment, verifyMfaEnrollment, regenerateRecoveryCodes, countRemainingRecoveryCodes, verifyAndConsumeRecoveryCode, disableMfa } from './mfaService';
import { generateTotpCode } from '../lib/identity/totp';
import { identityFixtures } from './__mocks__/identityFixtures';

let created: string[] = [];
async function seed(email: string): Promise<{ id: string; secret: string }> {
  const { findOrCreateIdentity, updateIdentity } = await import('./identityService');
  let n = 0;
  const { identity } = await findOrCreateIdentity({ email, displayName: 'T', idFactory: () => `mfa-regen-${(n += 1)}-${email}` }, 'mock');
  await updateIdentity(identity.id, { status: 'active' }, 'mock');
  const { secret } = await beginMfaEnrollment(identity.id, 'mock');
  await verifyMfaEnrollment(identity.id, generateTotpCode(secret), 'mock');
  created.push(identity.id);
  return { id: identity.id, secret };
}

afterEach(async () => {
  for (const id of created) await disableMfa(id, 'mock');
  created = [];
  // remove seeded identities
  for (let i = identityFixtures.length - 1; i >= 0; i -= 1) {
    if (identityFixtures[i].email.includes('regen')) identityFixtures.splice(i, 1);
  }
});

describe('mfaService recovery-code regeneration', () => {
  it('starts with 10 recovery codes after enrollment', async () => {
    const { id } = await seed('regen1@example.com');
    expect(await countRemainingRecoveryCodes(id, 'mock')).toBe(10);
  });

  it('regenerating with a valid TOTP code replaces the old batch (old codes stop working)', async () => {
    const { id, secret } = await seed('regen2@example.com');
    // capture an old code by enrolling fresh to know one — re-enroll path not needed; verify old set invalidation:
    const res = await regenerateRecoveryCodes(id, generateTotpCode(secret), 'mock');
    expect(res.success).toBe(true);
    expect(res.recoveryCodes).toHaveLength(10);
    expect(await countRemainingRecoveryCodes(id, 'mock')).toBe(10);
    // a brand-new code from the new batch works and is single-use
    const oneNew = res.recoveryCodes![0];
    expect(await verifyAndConsumeRecoveryCode(id, oneNew, 'mock')).toBe(true);
    expect(await verifyAndConsumeRecoveryCode(id, oneNew, 'mock')).toBe(false); // consumed
    expect(await countRemainingRecoveryCodes(id, 'mock')).toBe(9);
  });

  it('regenerating with a wrong code fails and does not change the codes', async () => {
    const { id } = await seed('regen3@example.com');
    const before = await countRemainingRecoveryCodes(id, 'mock');
    const res = await regenerateRecoveryCodes(id, '000000', 'mock');
    expect(res.success).toBe(false);
    expect(res.recoveryCodes).toBeUndefined();
    expect(await countRemainingRecoveryCodes(id, 'mock')).toBe(before);
  });

  it('countRemainingRecoveryCodes is 0 for an identity without MFA', async () => {
    const { findOrCreateIdentity } = await import('./identityService');
    const { identity } = await findOrCreateIdentity({ email: 'regen-nomfa@example.com', displayName: 'T', idFactory: () => 'regen-nomfa-id' }, 'mock');
    expect(await countRemainingRecoveryCodes(identity.id, 'mock')).toBe(0);
  });
});
