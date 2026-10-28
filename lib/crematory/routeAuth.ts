import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization, type RouteAuthorizationResult } from '@/lib/auth/requireAuthorizedOrganization';
import { canGenerateDocument, canManageOrganization, canReadCases, canSendToCrematory } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { sendToCrematoryConfig } from '@/domain/crematory/crematorySettings';
import { CrematoryError } from '@/services/crematory/crematoryPackageService';

/**
 * Send to Crematory (2026-10). Shared authorization for its routes:
 *   'read'    — view readiness and packages (case read);
 *   'prepare' — confirm the permit and date, build the package
 *               (document.generate, as for any case document);
 *   'send'    — email packages to the crematory, including resending
 *               (crematory.send — its own permission, never implied by
 *               document.generate);
 *   'manage'  — recipients and the connected mailbox (organization.manage).
 * Every route also requires the organization to have Send to Crematory.
 */
export type CrematoryAccess = 'read' | 'prepare' | 'send' | 'manage';
type Context = Extract<RouteAuthorizationResult, { authorized: true }>['context'];

export async function authorizeCrematory(
  requestedOrganizationId: unknown,
  access: CrematoryAccess,
): Promise<{ context: Context; canSend: boolean; canPrepare: boolean; mode: ReturnType<typeof getDataAdapterMode>; response?: never } | { response: Response; context?: never }> {
  if (typeof requestedOrganizationId !== 'string' || !requestedOrganizationId) {
    return { response: NextResponse.json({ error: 'organizationId is required.' }, { status: 400 }) };
  }
  const auth = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!auth.authorized) return { response: auth.response };
  const { organizationId, userId, role } = auth.context;
  if (!sendToCrematoryConfig(organizationId)) {
    return { response: NextResponse.json({ error: 'Send to Crematory is not set up for this organization.' }, { status: 404 }) };
  }
  const mode = getDataAdapterMode();
  const params = { identityId: userId, organizationId, roleKey: role };
  const [canPrepare, canSend] = await Promise.all([canGenerateDocument(params, mode), canSendToCrematory(params, mode)]);
  const allowed =
    access === 'read' ? await canReadCases(params, mode) : access === 'prepare' ? canPrepare : access === 'send' ? canSend : await canManageOrganization(params, mode);
  if (!allowed) {
    const what =
      access === 'manage'
        ? 'manage crematory settings'
        : access === 'send'
          ? 'send documents to the crematory (ask an administrator for the Send Crematory Packages permission)'
          : access === 'prepare'
            ? 'prepare documents for the crematory'
            : 'view this';
    return { response: NextResponse.json({ error: `You are not authorized to ${what}.` }, { status: 403 }) };
  }
  return { context: auth.context, canSend, canPrepare, mode };
}

export function crematoryErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof CrematoryError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(fallback, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export const activityContext = (context: Context, correlationId: string) => ({
  organizationId: context.organizationId,
  actorIdentityId: context.userId,
  actorMembershipId: null,
  actorRoleKey: context.role,
  correlationId,
});
