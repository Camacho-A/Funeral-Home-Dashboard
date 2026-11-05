import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuthorizedOrganization, type RouteAuthorizationResult } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { deathCertificateFaxSettings } from '@/domain/faxBundles/faxSettings';
import { FaxSettingsServiceError } from '@/services/faxSettings/faxSettingsService';
import type { ActivityContext } from '@/services/activityService';

/**
 * Fax Settings (2026-11). Every route: a signed-in member of THIS
 * organization (from the session's membership, never the request alone)
 * holding organization.manage (Administrators), for an organization that
 * has faxing. Viewing is administrators-only too: the page shows the
 * mailbox address and the configuration of an outbound channel. The
 * service checks organization.manage again on every change.
 */
type Context = Extract<RouteAuthorizationResult, { authorized: true }>['context'];

export async function authorizeFaxSettings(
  requestedOrganizationId: unknown,
): Promise<{ context: Context; activity: ActivityContext; mode: ReturnType<typeof getDataAdapterMode>; response?: never } | { response: Response; context?: never }> {
  if (typeof requestedOrganizationId !== 'string' || !requestedOrganizationId) {
    return { response: NextResponse.json({ error: 'organizationId is required.' }, { status: 400 }) };
  }
  const auth = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!auth.authorized) return { response: auth.response };
  const { organizationId, userId, role } = auth.context;
  if (!deathCertificateFaxSettings(organizationId)) {
    return { response: NextResponse.json({ error: 'Faxing is not set up for this organization.' }, { status: 404 }) };
  }
  const mode = getDataAdapterMode();
  if (!(await canManageOrganization({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return { response: NextResponse.json({ error: 'Only administrators can view or change Fax Settings.' }, { status: 403 }) };
  }
  const activity: ActivityContext = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  return { context: auth.context, activity, mode };
}

export function faxSettingsErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof FaxSettingsServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(fallback, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** Reads a JSON object body; null when it is not one. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
