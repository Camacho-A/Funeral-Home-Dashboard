import { NextResponse } from 'next/server';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { canReadAuditLog } from '@/services/authorizationPolicyService';
import { listForOrganization } from '@/services/activityService';
import { parseActivityFilters } from '@/lib/activityQueryParams';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). The organization-wide
 * Audit Center's data source — identity-mode only (same reasoning as
 * every `/api/rbac/*` route: `audit.read` is a new RBAC permission with
 * no legacy mock/wix precedent to preserve), gated by `audit.read`.
 * Keyset-paginated; see `activityService.ts`'s own comment on the
 * index-backed vs. in-application filter split.
 */
export async function GET(request: Request) {
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;
  const { identity, identitySession, dataAdapterMode } = access;

  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authz = await resolveMembershipAuthorizationContext(identitySession, dataAdapterMode, organizationId);
  if (!authz.granted) {
    return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 403 });
  }
  if (!(await canReadAuditLog({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to view the audit log for this organization.' }, { status: 403 });
  }

  const { filters, error } = parseActivityFilters(url.searchParams);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const cursor = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : 25;

  const result = await listForOrganization(authz.context.organizationId, filters, cursor, limit, dataAdapterMode);
  return NextResponse.json({ events: result.events, nextCursor: result.nextCursor });
}
