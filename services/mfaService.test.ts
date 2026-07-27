import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { identityFixtures } from './__mocks__/identityFixtures';
import { generateTotpCode } from '../lib/identity/totp';
import { decryptTotpSecret } from '../lib/identity/mfaSecretEncryption';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `mfa-test-${idCounter}`;
}

let lengthBefore: number;
beforeEach(() => {
  idCounter = 0;
  lengthBefore = identityFixtures.length;
});
afterEach(() => {
  identityFixtures.length = lengthBefore;
});

async function seedIdentity(email: string) {
  const { findOrCreateIdentity } = await import('./identityService');
  return (await findOrCreateIdentity({ email, displayName: 'MFA Test', idFactory }, 'mock')).identity;
}

describe('beginMfaEnrollment / verifyMfaEnrollment', () => {
  it('enrolls and verifies MFA, producing recovery codes and enabling mfaEnabled', async () => {
    const { beginMfaEnrollment, verifyMfaEnrollment } = await import('./mfaService');
    const { getIdentityById, getIdentitySecrets } = await import('./identityService');
    const identity = await seedIdentity('mfa.enroll@example.com');

    const { secret } = await beginMfaEnrollment(identity.id, 'mock');
    expect((await getIdentityById(identity.id, 'mock'))?.mfaEnabled).toBe(false); // not yet enabled

    const code = generateTotpCode(secret);
    const result = await verifyMfaEnrollment(identity.id, code, 'mock');
    expect(result.success).toBe(true);
    expect(result.recoveryCodes).toHaveLength(10);

    const after = await getIdentityById(identity.id, 'mock');
    expect(after?.mfaEnabled).toBe(true);

    const secrets = await getIdentitySecrets(identity.id, 'mock');
    expect(secrets?.mfaVerifiedAt).not.toBeNull();
  });

  it('rejects an incorrect code and never enables MFA', async () => {
    const { beginMfaEnrollment, verifyMfaEnrollment } = await import('./mfaService');
    const { getIdentityById } = await import('./identityService');
    const identity = await seedIdentity('mfa.wrongcode@example.com');
    await beginMfaEnrollment(identity.id, 'mock');

    const result = await verifyMfaEnrollment(identity.id, '000000', 'mock');
    expect(result.success).toBe(false);
    expect((await getIdentityById(identity.id, 'mock'))?.mfaEnabled).toBe(false);
  });

  it('never stores the plaintext TOTP secret anywhere', async () => {
    const { beginMfaEnrollment } = await import('./mfaService');
    const { getIdentitySecrets } = await import('./identityService');
    const identity = await seedIdentity('mfa.secretcheck@example.com');
    const { secret } = await beginMfaEnrollment(identity.id, 'mock');

    const stored = await getIdentitySecrets(identity.id, 'mock');
    expect(stored?.mfaSecretReference).not.toBe(secret);
    expect(stored?.mfaSecretReference).not.toContain(secret);
    expect(decryptTotpSecret(stored!.mfaSecretReference!)).toBe(secret); // but still recoverable server-side
  });
});

describe('verifyMfaCode (login-time challenge)', () => {
  it('accepts a valid code after enrollment', async () => {
    const { beginMfaEnrollment, verifyMfaEnrollment, verifyMfaCode } = await import('./mfaService');
    const identity = await seedIdentity('mfa.login@example.com');
    const { secret } = await beginMfaEnrollment(identity.id, 'mock');
    await verifyMfaEnrollment(identity.id, generateTotpCode(secret), 'mock');

    expect(await verifyMfaCode(identity.id, generateTotpCode(secret), 'mock')).toBe(true);
  });

  it('rejects a code for an identity with no MFA enrolled at all', async () => {
    const { verifyMfaCode } = await import('./mfaService');
    const identity = await seedIdentity('mfa.none@example.com');
    expect(await verifyMfaCode(identity.id, '123456', 'mock')).toBe(false);
  });
});

describe('verifyAndConsumeRecoveryCode', () => {
  it('accepts a valid recovery code exactly once', async () => {
    const { beginMfaEnrollment, verifyMfaEnrollment, verifyAndConsumeRecoveryCode } = await import('./mfaService');
    const identity = await seedIdentity('mfa.recovery@example.com');
    const { secret } = await beginMfaEnrollment(identity.id, 'mock');
    const { recoveryCodes } = await verifyMfaEnrollment(identity.id, generateTotpCode(secret), 'mock');
    const code = recoveryCodes![0];

    expect(await verifyAndConsumeRecoveryCode(identity.id, code, 'mock')).toBe(true);
    expect(await verifyAndConsumeRecoveryCode(identity.id, code, 'mock')).toBe(false); // single-use
  });

  it('rejects an unknown recovery code', async () => {
    const { verifyAndConsumeRecoveryCode } = await import('./mfaService');
    const identity = await seedIdentity('mfa.badrecovery@example.com');
    expect(await verifyAndConsumeRecoveryCode(identity.id, 'not-a-real-code', 'mock')).toBe(false);
  });
});

describe('disableMfa', () => {
  it('clears secret, verifiedAt, recovery codes, and mfaEnabled', async () => {
    const { beginMfaEnrollment, verifyMfaEnrollment, disableMfa } = await import('./mfaService');
    const { getIdentityById, getIdentitySecrets } = await import('./identityService');
    const identity = await seedIdentity('mfa.disable@example.com');
    const { secret } = await beginMfaEnrollment(identity.id, 'mock');
    await verifyMfaEnrollment(identity.id, generateTotpCode(secret), 'mock');

    await disableMfa(identity.id, 'mock');

    expect((await getIdentityById(identity.id, 'mock'))?.mfaEnabled).toBe(false);
    const secrets = await getIdentitySecrets(identity.id, 'mock');
    expect(secrets?.mfaSecretReference).toBeNull();
    expect(secrets?.mfaRecoveryCodeHashes).toEqual([]);
  });
});
