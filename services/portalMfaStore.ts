import type { DataAdapterMode } from '../lib/env';
import { mockCollection } from './__mocks__/mockStore';
import { deleteWixDataItem, insertWixDataItem, queryWixDataItems, updateWixDataItem } from '../lib/wixDataApi';

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
  const response = await queryWixDataItems<PortalMfaSetupGrant>(GRANTS, { filter: { scopeId, identityId }, paging: { limit: 50 } });
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
