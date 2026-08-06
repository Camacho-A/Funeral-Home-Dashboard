import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canManagePortal } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { listPortalAccessForCase, disablePortalAccess, revokePortalAccess } from '@/services/portal/portalAccessService';
import { recordPortalAccessRevoked } from '@/services/activityService';
import crypto from 'crypto';

const VALID_ACTIONS = ['disable', 'revoke'] as const;

/**
 * Phase 29 (Family Portal & External Collaboration). Staff-side, gated by
 * `portal.manage`. The access row is looked up via `listPortalAccessForCase`
 * (already scoped to `organizationId`/`caseId`) rather than a bare
 * id-only lookup, so a staff member can never disable/revoke another
 * organization's grant by guessing an id. Fails closed immediately on
 * the very next family request — never cached (see
 * `lib/auth/requireFamilyAccess.ts`).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ caseId: string; accessId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId, accessId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; action?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (typeof b.action !== 'string' || !VALID_ACTIONS.includes(b.action as (typeof VALID_ACTIONS)[number])) {
    return NextResponse.json({ error: 'action must be "disable" or "revoke".' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canManagePortal({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to manage Family Portal access for this case.' }, { status: 403 });
  }

  const access = (await listPortalAccessForCase(organizationId, caseId, dataAdapterMode)).find((a) => a.id === accessId);
  if (!access) {
    return NextResponse.json({ error: 'Portal access grant not found for this case.' }, { status: 404 });
  }

  const updated = b.action === 'disable' ? await disablePortalAccess(accessId, dataAdapterMode) : await revokePortalAccess(accessId, dataAdapterMode);

  // Only "revoke" (permanent) is narrated as portal.access_revoked — no
  // ACTIVITY_EVENT_TYPES entry exists for a temporary "disable", and
  // inventing one to match this route's own action name would be
  // inaccurate about what actually happened.
  if (b.action === 'revoke') {
    try {
      await recordPortalAccessRevoked(
        { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
        caseId,
        accessId,
        access.relationshipType,
        dataAdapterMode,
      );
    } catch (error) {
      console.error('Failed to record portal.access_revoked activity event:', error instanceof Error ? error.message : error);
    }
  }

  return NextResponse.json({ access: updated });
}
