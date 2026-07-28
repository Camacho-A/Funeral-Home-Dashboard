import { NextResponse } from 'next/server';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { resolvePermissions } from '@/services/permissionService';

/**
 * Phase 22 (Role-Based Access Control). The current session's own
 * resolved permission set for one organization — the Permission
 * Inspector's data source, and what client-side UI-gating hooks
 * (`hooks/useMyPermissions.ts`) read to decide whether to *show* a
 * control. Never itself an authorization decision: the server remains the
 * source of truth for every actual operation (each mutating Route Handler
 * re-resolves and re-checks permissions on its own), so a stale or
 * tampered client read of this endpoint can at most mis-render the UI,
 * never grant an action.
 *
 * Phase 23 (Team Management): response also includes `identityId` — the
 * only client-exposed way to learn the caller's own identity id, which the
 * Team page needs to hide/disable self-targeting status-change controls
 * (a UI convenience; `PATCH /api/rbac/membership-status` already refuses a
 * self-targeted request server-side regardless of what the UI shows).
 */
export async function GET(request: Request) {
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }

  const permissions = await resolvePermissions(
    { identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role },
    dataAdapterMode,
  );

  return NextResponse.json({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role, permissions: [...permissions].sort() });
}
