import { NextResponse } from 'next/server';
import type { PortalUser } from '../../types/portalUser';
import type { PortalAccess } from '../../types/portalAccess';
import type { DataAdapterMode } from '../env';
import { requireFamilySession } from './requireFamilySession';
import { getPortalAccessForPortalUserAndCase } from '../../services/portal/portalAccessService';
import { hasPortalCapability, type PortalCapabilityKey } from '../../domain/portal/portalCapabilityPolicy';

/**
 * Phase 29 (Family Portal & External Collaboration). The one function
 * every family-side Route Handler that touches case data must call —
 * the family-side sibling of `requireAuthorizedOrganization.ts`, and the
 * single place refinement #1's full resolution chain lives:
 *
 *   beacon_family_session cookie
 *     -> verified against the family-only signing context/audience (requireFamilySession)
 *     -> PortalSession row (portalUserId)
 *     -> PortalAccess row, looked up by (portalUserId, requested caseId) —
 *        never by a client-supplied organizationId
 *     -> PortalAccess.status === 'active' (fail closed otherwise)
 *     -> organizationId is READ FROM the PortalAccess row itself, never
 *        accepted as request input
 *     -> hasPortalCapability(access, requiredCapability) — fail closed if absent
 *
 * Only once all of the above succeed does a caller get back a
 * server-derived `organizationId`/`caseId` to hand to the underlying
 * service (documentService/paymentsService/appointmentReads/etc.) — the
 * caller is then responsible for shaping that service's return value
 * through an allowlisting DTO before it reaches the response body.
 *
 * Every denial reason (no session, no grant, wrong status, missing
 * capability) is deliberately collapsed into the same generic response —
 * mirroring `requireAuthorizedOrganization.ts`'s own "do not leak
 * organization/case existence" discipline — except "no session at all,"
 * which gets the standard 401 vs. 403 HTTP distinction.
 */
export type FamilyAccessResult =
  | { authorized: true; portalUser: PortalUser; access: PortalAccess; organizationId: string; caseId: string; dataAdapterMode: DataAdapterMode }
  | { authorized: false; response: NextResponse };

const FORBIDDEN_RESPONSE = () => NextResponse.json({ error: 'Not authorized for this case.' }, { status: 403 });

export async function requireFamilyAccess(caseId: string, requiredCapability: PortalCapabilityKey): Promise<FamilyAccessResult> {
  const sessionResult = await requireFamilySession();
  if (!sessionResult.authorized) {
    return sessionResult;
  }

  const access = await getPortalAccessForPortalUserAndCase(sessionResult.portalUser.id, caseId, sessionResult.dataAdapterMode);
  if (!access || access.status !== 'active' || !hasPortalCapability(access, requiredCapability)) {
    return { authorized: false, response: FORBIDDEN_RESPONSE() };
  }

  return {
    authorized: true,
    portalUser: sessionResult.portalUser,
    access,
    organizationId: access.organizationId,
    caseId: access.caseId,
    dataAdapterMode: sessionResult.dataAdapterMode,
  };
}
