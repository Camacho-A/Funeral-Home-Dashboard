import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionToken, verifySessionToken } from '@/lib/auth/sessionToken';
import { encryptTotpSecret, tryDecryptTotpSecret } from '@/lib/identity/mfaSecretEncryption';
import { beginMfaEnrollment, isMfaSecretReadableHere, verifyMfaCode } from './mfaService';
import { getIdentitySecrets } from './identityService';
import { identityFixtures, MANORS_ADMIN_IDENTITY_ID } from './__mocks__/identityFixtures';
import { formatCaseNumber, prefixForNewCaseNumber } from '@/domain/cases/caseNumber';
import { caseFixtures } from './__mocks__/fixtures';

/**
 * Unified portal (Phase 5N): sessions, MFA and case numbers when two
 * deployments (Manors Production and the unified portal) share one
 * identity store. Fictional keys only.
 */
afterEach(() => vi.unstubAllEnvs());

describe('sessions: a session from one deployment is not accepted by another', () => {
  it('a token signed with one deployment secret does not verify under another', async () => {
    vi.stubEnv('SESSION_JWT_SECRET', 'fictional-manors-production-secret');
    const token = await createSessionToken({ id: 'identity-x', email: 'x@example.test', displayName: 'X', source: 'identity' }, undefined, 'session-x');
    expect(await verifySessionToken(token)).not.toBeNull();
    vi.stubEnv('SESSION_JWT_SECRET', 'fictional-unified-portal-secret');
    expect(await verifySessionToken(token)).toBeNull();
  });
});

describe('MFA enrolled under another deployment key', () => {
  it('cannot be read here — fails safely (no exception), and nothing is overwritten', async () => {
    vi.stubEnv('MFA_ENCRYPTION_KEY', 'fictional-key-a');
    const reference = encryptTotpSecret('JBSWY3DPEHPK3PXP');
    expect(tryDecryptTotpSecret(reference)).toBe('JBSWY3DPEHPK3PXP');
    vi.stubEnv('MFA_ENCRYPTION_KEY', 'fictional-key-b');
    expect(tryDecryptTotpSecret(reference)).toBeNull();
  });

  it('sign-in can tell, and a code check returns false instead of throwing; the stored enrollment is unchanged', async () => {
    const identity = identityFixtures.find((i) => i.id === MANORS_ADMIN_IDENTITY_ID)!;
    const original = { mfaSecretReference: identity.mfaSecretReference };
    try {
      vi.stubEnv('MFA_ENCRYPTION_KEY', 'fictional-manors-key');
      await beginMfaEnrollment(identity.id, 'mock');
      const stored = (await getIdentitySecrets(identity.id, 'mock'))!.mfaSecretReference;
      expect(await isMfaSecretReadableHere(identity.id, 'mock')).toBe(true);
      vi.stubEnv('MFA_ENCRYPTION_KEY', 'fictional-unified-key');
      expect(await isMfaSecretReadableHere(identity.id, 'mock')).toBe(false);
      await expect(verifyMfaCode(identity.id, '123456', 'mock')).resolves.toBe(false);
      expect((await getIdentitySecrets(identity.id, 'mock'))!.mfaSecretReference).toBe(stored);
    } finally {
      identity.mfaSecretReference = original.mfaSecretReference;
    }
  });
});

describe('case numbers stay per organization', () => {
  it('each organization keeps its own prefix; the same sequence gives different numbers', () => {
    const manors = prefixForNewCaseNumber(null, 'managed-cremations');
    const gus = prefixForNewCaseNumber(null, 'gus-camacho-jr');
    expect(manors).toBe('B');
    expect(gus).toBe('M');
    expect(formatCaseNumber(2026, 7, manors)).not.toBe(formatCaseNumber(2026, 7, gus));
  });

  it('no case number repeats within an organization; identity is organization + case', () => {
    const byOrg = new Map<string, Set<string>>();
    for (const c of caseFixtures) {
      const seen = byOrg.get(c.organizationId) ?? new Set();
      expect(seen.has(c.caseNumber), `${c.organizationId} ${c.caseNumber}`).toBe(false);
      seen.add(c.caseNumber);
      byOrg.set(c.organizationId, seen);
    }
    expect(byOrg.get('managed-cremations')!.size).toBeGreaterThan(0);
    expect(byOrg.get('gus-camacho-jr')!.size).toBeGreaterThan(0);
    for (const n of byOrg.get('managed-cremations')!) expect(n.startsWith('B')).toBe(true);
    for (const n of byOrg.get('gus-camacho-jr')!) expect(n.startsWith('M')).toBe(true);
  });
});
