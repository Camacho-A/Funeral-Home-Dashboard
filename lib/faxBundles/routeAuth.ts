import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization, type RouteAuthorizationResult } from '@/lib/auth/requireAuthorizedOrganization';
import { canConfirmFax, canReadCases, canSendFax, canViewDocument } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { deathCertificateFaxSettings } from '@/domain/faxBundles/faxSettings';
import { FaxBundleError } from '@/services/faxBundles/faxBundleError';

/**
 * Manatee County DC application fax bundles (2026-11). Shared route
 * authorization — the organization always comes from the signed-in
 * session's membership, never from the request alone:
 *   'read'    — a case's fax history and a bundle's status (case read);
 *   'send'    — eligible cases, preview, the bundle PDF and Send Fax
 *               (fax.send — by default Administrator, Manager, Funeral
 *               Director, Office Staff and Arranger — and document.view);
 *   'outcome' — record delivered / failed (fax.confirm — the same roles
 *               except Arranger).
 * Permissions come from the member's role in THIS organization, resolved on
 * the server (roles, grants and organization overrides) — never from the
 * request.
 * Every route also requires the organization to have fax bundles set up.
 */
export type FaxAccess = 'read' | 'send' | 'outcome';
type Context = Extract<RouteAuthorizationResult, { authorized: true }>['context'];

export async function authorizeFax(
  requestedOrganizationId: unknown,
  access: FaxAccess,
): Promise<{ context: Context; mode: ReturnType<typeof getDataAdapterMode>; response?: never } | { response: Response; context?: never }> {
  if (typeof requestedOrganizationId !== 'string' || !requestedOrganizationId) {
    return { response: NextResponse.json({ error: 'organizationId is required.' }, { status: 400 }) };
  }
  const auth = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!auth.authorized) return { response: auth.response };
  const { organizationId, userId, role } = auth.context;
  if (!deathCertificateFaxSettings(organizationId)) {
    return { response: NextResponse.json({ error: 'Faxing DC applications is not set up for this organization.' }, { status: 404 }) };
  }
  const mode = getDataAdapterMode();
  const params = { identityId: userId, organizationId, roleKey: role };
  let allowed: boolean;
  if (access === 'read') allowed = await canReadCases(params, mode);
  else if (access === 'send') allowed = (await canSendFax(params, mode)) && (await canViewDocument(params, mode));
  else allowed = await canConfirmFax(params, mode);
  if (!allowed) {
    const what = access === 'outcome' ? 'record whether a fax was delivered (ask an administrator for that permission)' : access === 'send' ? 'fax DC applications (ask an administrator for that permission)' : 'view this';
    return { response: NextResponse.json({ error: `You are not authorized to ${what}.` }, { status: 403 }) };
  }
  return { context: auth.context, mode };
}

export function faxErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof FaxBundleError) return NextResponse.json({ error: error.message, caseProblems: error.caseProblems }, { status: error.status });
  console.error(fallback, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export const faxActivityContext = (context: Context, correlationId: string) => ({
  organizationId: context.organizationId,
  actorIdentityId: context.userId,
  actorMembershipId: null,
  actorRoleKey: context.role,
  correlationId,
});
