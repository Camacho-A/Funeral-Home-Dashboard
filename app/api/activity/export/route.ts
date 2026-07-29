import { NextResponse } from 'next/server';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { resolveMembershipAuthorizationContext } from '@/lib/auth/resolveMembershipAuthorizationContext';
import { canExportAuditLog } from '@/services/authorizationPolicyService';
import { exportCsv } from '@/services/activityService';
import { parseActivityFilters } from '@/lib/activityQueryParams';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). CSV export — same
 * filters as `GET /api/activity`, no pagination (bounded by
 * `activityService.ts`'s own row cap instead), gated by the narrower
 * `audit.export` permission. PDF export is deliberately not built this
 * phase (see ADR-028) — no PDF-generation dependency exists in this
 * project yet.
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
  if (!(await canExportAuditLog({ identityId: identity.id, organizationId: authz.context.organizationId, roleKey: authz.context.role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to export the audit log for this organization.' }, { status: 403 });
  }

  const { filters, error } = parseActivityFilters(url.searchParams);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const csv = await exportCsv(authz.context.organizationId, filters, dataAdapterMode);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="activity-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
