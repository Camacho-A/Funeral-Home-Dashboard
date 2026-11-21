import type { DataAdapterMode } from '../lib/env';
import { mockCollection } from './__mocks__/mockStore';
import { deleteWixDataItem, insertWixDataItem, queryWixDataItems, updateWixDataItem, WixDataApiError } from '../lib/wixDataApi';

/**
 * Portal-scoped MFA storage (Phase 5N follow-up, 2026-11) — see
 * lib/identity/portalMfaScope.ts. One enrollment per (portal scope,
 * identity), and one-time setup grants an administrator issues so a person
 * already protected by MFA elsewhere can enroll here without ever falling
 * back to password-only. Never touches the shared identity record.
 *
 * Live storage: two NEW Wix collections, `portalMfaEnrollments` and
 * `portalMfaSetupGrants`, which do not exist yet — creating them is a live
 * schema change awaiting approval (docs/UNIFIED_PORTAL.md › MFA). Until
 * then this runs on fictional mock data only.
 */
export type PortalMfaEnrollment = {
  scopeId: string;
  identityId: string;
  /** AES-256-GCM ciphertext under THIS portal's key. */
  secretReference: string | null;
  verifiedAt: string | null;
  recoveryCodeHashes: string[];
  createdAt: string;
  updatedAt: string;
};

export type PortalMfaSetupGrant = {
  /** Rows in portalMfaSetupGrants are either a grant or the single claim that used it. */
  kind: 'grant';
  id: string;
  scopeId: string;
  identityId: string;
  /** Only the hash of the one-time code is stored. */
  codeHash: string;
  organizationId: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};

/**
 * The one record that marks a grant as used. Its Wix `_id` is fixed
 * (`{grantId}-redeemed`), and Wix refuses a second insert with the same
 * `_id` (409) — so of any number of simultaneous redemptions, exactly one
 * succeeds. This is the replay guard; the grant's own `usedAt` is only a
 * convenience copy written afterwards.
 */
export type PortalMfaSetupRedemption = { kind: 'redemption'; id: string; grantId: string; scopeId: string; identityId: string; redeemedAt: string };
export const redemptionId = (grantId: string) => `${grantId}-redeemed`;
export const portalMfaSetupRedemptionFixtures: PortalMfaSetupRedemption[] = mockCollection('portalMfaSetupRedemptionFixtures', (): PortalMfaSetupRedemption[] => []);

export const portalMfaEnrollmentFixtures: PortalMfaEnrollment[] = mockCollection('portalMfaEnrollmentFixtures', (): PortalMfaEnrollment[] => []);
export const portalMfaSetupGrantFixtures: PortalMfaSetupGrant[] = mockCollection('portalMfaSetupGrantFixtures', (): PortalMfaSetupGrant[] => []);

const ENROLLMENTS = 'portalMfaEnrollments';
const GRANTS = 'portalMfaSetupGrants';
const enrollmentItemId = (scopeId: string, identityId: string) => `${scopeId}-${identityId}`.slice(0, 120);

export async function getPortalEnrollment(scopeId: string, identityId: string, mode: DataAdapterMode): Promise<PortalMfaEnrollment | null> {
  if (mode === 'mock') return portalMfaEnrollmentFixtures.find((e) => e.scopeId === scopeId && e.identityId === identityId) ?? null;
  const response = await queryWixDataItems<PortalMfaEnrollment>(ENROLLMENTS, { filter: { scopeId, identityId }, paging: { limit: 1 } });
  return response.dataItems[0]?.data ?? null;
}

export async function savePortalEnrollment(enrollment: PortalMfaEnrollment, mode: DataAdapterMode): Promise<void> {
  if (mode === 'mock') {
    const index = portalMfaEnrollmentFixtures.findIndex((e) => e.scopeId === enrollment.scopeId && e.identityId === enrollment.identityId);
    if (index === -1) portalMfaEnrollmentFixtures.push(enrollment);
    else portalMfaEnrollmentFixtures[index] = enrollment;
    return;
  }
  const id = enrollmentItemId(enrollment.scopeId, enrollment.identityId);
  const existing = await queryWixDataItems<PortalMfaEnrollment>(ENROLLMENTS, { filter: { scopeId: enrollment.scopeId, identityId: enrollment.identityId }, paging: { limit: 1 } });
  if (existing.dataItems[0]) await updateWixDataItem(ENROLLMENTS, existing.dataItems[0].id, enrollment);
  else await insertWixDataItem(ENROLLMENTS, enrollment, id);
}

export async function deletePortalEnrollment(scopeId: string, identityId: string, mode: DataAdapterMode): Promise<void> {
  if (mode === 'mock') {
    const index = portalMfaEnrollmentFixtures.findIndex((e) => e.scopeId === scopeId && e.identityId === identityId);
    if (index !== -1) portalMfaEnrollmentFixtures.splice(index, 1);
    return;
  }
  const existing = await queryWixDataItems<PortalMfaEnrollment>(ENROLLMENTS, { filter: { scopeId, identityId }, paging: { limit: 1 } });
  if (existing.dataItems[0]) await deleteWixDataItem(ENROLLMENTS, existing.dataItems[0].id);
}

export async function listSetupGrants(scopeId: string, identityId: string, mode: DataAdapterMode): Promise<PortalMfaSetupGrant[]> {
  if (mode === 'mock') return portalMfaSetupGrantFixtures.filter((g) => g.scopeId === scopeId && g.identityId === identityId);
  const response = await queryWixDataItems<PortalMfaSetupGrant>(GRANTS, { filter: { scopeId, identityId, kind: 'grant' }, paging: { limit: 50 } });
  return response.dataItems.map((i) => i.data);
}

export async function saveSetupGrant(grant: PortalMfaSetupGrant, mode: DataAdapterMode): Promise<void> {
  if (mode === 'mock') {
    const index = portalMfaSetupGrantFixtures.findIndex((g) => g.id === grant.id);
    if (index === -1) portalMfaSetupGrantFixtures.push(grant);
    else portalMfaSetupGrantFixtures[index] = grant;
    return;
  }
  const existing = await queryWixDataItems<PortalMfaSetupGrant>(GRANTS, { filter: { id: grant.id }, paging: { limit: 1 } });
  if (existing.dataItems[0]) await updateWixDataItem(GRANTS, existing.dataItems[0].id, grant);
  else await insertWixDataItem(GRANTS, grant, grant.id);
}

/** True when this call — and only this call — claimed the grant. */
export async function claimSetupGrant(grant: PortalMfaSetupGrant, redeemedAt: string, mode: DataAdapterMode): Promise<boolean> {
  const claim: PortalMfaSetupRedemption = { kind: 'redemption', id: redemptionId(grant.id), grantId: grant.id, scopeId: grant.scopeId, identityId: grant.identityId, redeemedAt };
  if (mode === 'mock') {
    if (portalMfaSetupRedemptionFixtures.some((r) => r.id === claim.id)) return false;
    portalMfaSetupRedemptionFixtures.push(claim);
    return true;
  }
  try {
    await insertWixDataItem(GRANTS, claim, claim.id);
    return true;
  } catch (error) {
    if (error instanceof WixDataApiError && error.status === 409) return false;
    throw error;
  }
}

export async function isSetupGrantClaimed(grantId: string, mode: DataAdapterMode): Promise<boolean> {
  if (mode === 'mock') return portalMfaSetupRedemptionFixtures.some((r) => r.grantId === grantId);
  const response = await queryWixDataItems<PortalMfaSetupRedemption>(GRANTS, { filter: { kind: 'redemption', grantId }, paging: { limit: 1 } });
  return response.dataItems.length > 0;
}
