import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTotpCode } from '@/lib/identity/totp';
import { identityFixtures, membershipFixtures, MANORS_ADMIN_IDENTITY_ID } from './__mocks__/identityFixtures';
import { GUS_ADMIN_IDENTITY_ID } from './__mocks__/gusFixtures';
import { buildDualOrganizationIdentities, buildDualOrganizationMemberships, CASEY_DUAL_IDENTITY_ID } from './__mocks__/dualOrganizationFixtures';
import { portalMfaEnrollmentFixtures, portalMfaSetupGrantFixtures } from './portalMfaStore';
import { beginMfaEnrollment, verifyMfaEnrollment, verifyMfaCode, verifyAndConsumeRecoveryCode, getMfaState, disableMfa, countRemainingRecoveryCodes, regenerateRecoveryCodes } from './mfaService';
import { getIdentityById, getIdentitySecrets } from './identityService';
import { identityMustEnrollMfa, mfaEnrollmentRequiredFor } from './mfaPolicyService';
import { issuePortalMfaSetupCode, redeemPortalMfaSetupCode, PortalMfaSetupError, SETUP_CODE_TTL_MS } from './portalMfaSetupGrantService';
import { portalMfaScopeId } from '@/lib/identity/portalMfaScope';

/**
 * Portal-scoped MFA (Phase 5N follow-up). Fictional identities and keys.
 * "Manors Production" = legacy mode with key A (the original fields on the
 * shared identity record). "Unified portal" = portal-scoped mode with key B
 * (its own store). Enrolling in the unified portal must never overwrite or
 * invalidate the Manors enrollment or its recovery codes.
 */
const MANORS_KEY = 'fictional-manors-production-mfa-key';
const PORTAL_KEY = 'fictional-unified-portal-mfa-key';
const asManorsProduction = () => {
  vi.stubEnv('SOLIS_PORTAL_SCOPED_MFA', '');
  vi.stubEnv('MFA_ENCRYPTION_KEY', MANORS_KEY);
};
const asUnifiedPortal = () => {
  vi.stubEnv('SOLIS_PORTAL_SCOPED_MFA', 'true');
  vi.stubEnv('MFA_ENCRYPTION_KEY', PORTAL_KEY);
};
const ID = CASEY_DUAL_IDENTITY_ID;
let lengths: { identities: number; memberships: number };

/** Enrolls `identityId` on whichever portal is current; returns its secret and recovery codes. */
async function enroll(identityId: string) {
  const { secret } = await beginMfaEnrollment(identityId, 'mock');
  const result = await verifyMfaEnrollment(identityId, generateTotpCode(secret), 'mock');
  expect(result.success).toBe(true);
  return { secret, recoveryCodes: result.recoveryCodes! };
}
const legacySnapshot = async (identityId: string) => {
  const secrets = (await getIdentitySecrets(identityId, 'mock'))!;
  const identity = (await getIdentityById(identityId, 'mock'))!;
  return { mfaEnabled: identity.mfaEnabled, mfaSecretReference: secrets.mfaSecretReference, mfaVerifiedAt: secrets.mfaVerifiedAt, mfaRecoveryCodeHashes: [...secrets.mfaRecoveryCodeHashes] };
};

beforeEach(() => {
  lengths = { identities: identityFixtures.length, memberships: membershipFixtures.length };
  identityFixtures.push(...(buildDualOrganizationIdentities() as never[]));
  membershipFixtures.push(...buildDualOrganizationMemberships());
  portalMfaEnrollmentFixtures.length = 0;
  portalMfaSetupGrantFixtures.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  identityFixtures.length = lengths.identities;
  membershipFixtures.length = lengths.memberships;
});

describe('a Manors enrollment is never touched by the unified portal', () => {
  it('enrolled at Manors: the unified portal sees "enrolled elsewhere", requires enrollment here, and reads/writes nothing of the original', async () => {
    asManorsProduction();
    const manors = await enroll(ID);
    const before = await legacySnapshot(ID);
    expect(before.mfaEnabled).toBe(true);

    asUnifiedPortal();
    const identity = (await getIdentityById(ID, 'mock'))!;
    expect(await getMfaState(identity, 'mock')).toEqual({ portalScoped: true, enabled: false, enrolledElsewhere: true });
    expect(await identityMustEnrollMfa(identity, 'mock')).toBe(true);
    expect(await mfaEnrollmentRequiredFor(identity, 'gus-camacho-jr', 'mock')).toBe(true); // even where the organization does not require MFA
    // The Manors authenticator and recovery codes do not work here — and trying them changes nothing.
    expect(await verifyMfaCode(ID, generateTotpCode(manors.secret), 'mock')).toBe(false);
    expect(await verifyAndConsumeRecoveryCode(ID, manors.recoveryCodes[0], 'mock')).toBe(false);
    expect(await legacySnapshot(ID)).toEqual(before);
  });

  it('enrolling in the unified portal creates its own enrollment and recovery codes; the Manors one keeps working afterwards', async () => {
    asManorsProduction();
    const manors = await enroll(ID);
    const before = await legacySnapshot(ID);

    asUnifiedPortal();
    const portal = await enroll(ID);
    expect(await getMfaState((await getIdentityById(ID, 'mock'))!, 'mock')).toMatchObject({ enabled: true, enrolledElsewhere: false });
    expect(portalMfaEnrollmentFixtures).toHaveLength(1);
    expect(portalMfaEnrollmentFixtures[0]).toMatchObject({ scopeId: portalMfaScopeId(), identityId: ID });
    // Recovery codes are stored only as hashes, separately per portal.
    expect(portalMfaEnrollmentFixtures[0].recoveryCodeHashes).not.toContain(portal.recoveryCodes[0]);
    expect(portalMfaEnrollmentFixtures[0].recoveryCodeHashes.some((h) => before.mfaRecoveryCodeHashes.includes(h))).toBe(false);
    expect(await verifyMfaCode(ID, generateTotpCode(portal.secret), 'mock')).toBe(true);
    expect(await verifyAndConsumeRecoveryCode(ID, portal.recoveryCodes[0], 'mock')).toBe(true);
    expect(await verifyAndConsumeRecoveryCode(ID, portal.recoveryCodes[0], 'mock')).toBe(false); // single use
    expect(await countRemainingRecoveryCodes(ID, 'mock')).toBe(9);
    expect(await legacySnapshot(ID)).toEqual(before);

    asManorsProduction();
    expect(await getMfaState((await getIdentityById(ID, 'mock'))!, 'mock')).toMatchObject({ portalScoped: false, enabled: true });
    expect(await verifyMfaCode(ID, generateTotpCode(manors.secret), 'mock')).toBe(true);
    expect(await verifyMfaCode(ID, generateTotpCode(portal.secret), 'mock')).toBe(false);
    expect(await countRemainingRecoveryCodes(ID, 'mock')).toBe(10);
  });

  it('regenerating or disabling in the unified portal affects only the unified portal', async () => {
    asManorsProduction();
    await enroll(ID);
    const before = await legacySnapshot(ID);
    asUnifiedPortal();
    const portal = await enroll(ID);
    expect((await regenerateRecoveryCodes(ID, generateTotpCode(portal.secret), 'mock')).success).toBe(true);
    await disableMfa(ID, 'mock');
    expect(portalMfaEnrollmentFixtures).toHaveLength(0);
    expect(await legacySnapshot(ID)).toEqual(before);
    expect(await getMfaState((await getIdentityById(ID, 'mock'))!, 'mock')).toMatchObject({ enabled: false, enrolledElsewhere: true });
  });

  it('someone with no two-step verification anywhere enrolls in the unified portal as usual; nothing is written to the shared record', async () => {
    asUnifiedPortal();
    const before = await legacySnapshot(ID);
    expect(await getMfaState((await getIdentityById(ID, 'mock'))!, 'mock')).toMatchObject({ enabled: false, enrolledElsewhere: false });
    await enroll(ID);
    expect(await legacySnapshot(ID)).toEqual(before);
  });
});

describe('one-time setup codes', () => {
  const issue = (actor: string, target = ID, organizationId = 'gus-camacho-jr', now?: string) =>
    issuePortalMfaSetupCode({ actorIdentityId: actor, organizationId, targetIdentityId: target, now, idFactory: () => crypto.randomUUID() }, 'mock');

  beforeEach(async () => {
    asManorsProduction();
    await enroll(ID);
    asUnifiedPortal();
  });

  it('issued by someone else for a member enrolled elsewhere: works once; only its hash is stored', async () => {
    const { code, grant } = await issue(GUS_ADMIN_IDENTITY_ID);
    expect(grant.codeHash).not.toContain(code.replace(/-/g, ''));
    expect(JSON.stringify(portalMfaSetupGrantFixtures)).not.toContain(code);
    expect(await redeemPortalMfaSetupCode(ID, code.toLowerCase(), 'mock')).toBe(true); // case and dashes do not matter
    expect(await redeemPortalMfaSetupCode(ID, code, 'mock')).toBe(false);
  });

  it('refused for oneself, for an outsider organization, for someone not enrolled elsewhere, and outside a portal-scoped deployment', async () => {
    await expect(issue(ID)).rejects.toMatchObject({ status: 403 });
    await expect(issue(GUS_ADMIN_IDENTITY_ID, ID, 'evergreen-memorial-group')).rejects.toMatchObject({ status: 404 });
    await expect(issue(CASEY_DUAL_IDENTITY_ID, GUS_ADMIN_IDENTITY_ID)).rejects.toBeInstanceOf(PortalMfaSetupError); // Gus admin has no MFA elsewhere
    asManorsProduction();
    await expect(issue(GUS_ADMIN_IDENTITY_ID)).rejects.toMatchObject({ status: 409 });
  });

  it('expires after 30 minutes; a new code revokes the earlier one; another person cannot use it', async () => {
    const t0 = '2026-11-20T12:00:00.000Z';
    const first = await issue(GUS_ADMIN_IDENTITY_ID, ID, 'gus-camacho-jr', t0);
    expect(await redeemPortalMfaSetupCode(ID, first.code, 'mock', new Date(Date.parse(t0) + SETUP_CODE_TTL_MS + 1000).toISOString())).toBe(false);
    const second = await issue(GUS_ADMIN_IDENTITY_ID, ID, 'gus-camacho-jr', t0);
    const third = await issue(MANORS_ADMIN_IDENTITY_ID, ID, 'managed-cremations', t0);
    expect(await redeemPortalMfaSetupCode(ID, second.code, 'mock', t0)).toBe(false); // revoked by the newer one
    expect(await redeemPortalMfaSetupCode(GUS_ADMIN_IDENTITY_ID, third.code, 'mock', t0)).toBe(false);
    expect(await redeemPortalMfaSetupCode(ID, third.code, 'mock', t0)).toBe(true);
  });
});
