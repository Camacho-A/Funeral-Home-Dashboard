import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { listForCase } from '@/services/activityService';

/**
 * Phase 24 (Case Activity Timeline & Audit Center). The Case Activity
 * tab's data source — keyset-paginated (see `activityService.ts`'s own
 * comment on why: Wix Data has no native cursor primitive).
 *
 * Gated by `requireAuthorizedOrganization` alone, matching
 * `GET /api/cases/[caseId]` itself exactly — no role in this codebase can
 * read a case's data but not its history (see ADR-028), and case routes
 * have never been migrated to a separate RBAC permission check, so adding
 * one only for this sub-resource would be a new, inconsistent gate rather
 * than "reusing an existing policy."
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;

  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ events: [], error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const cursor = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : 25;

  const dataAdapterMode = getDataAdapterMode();
  const result = await listForCase(organizationId, caseId, cursor, limit, dataAdapterMode);
  return NextResponse.json({ events: result.events, nextCursor: result.nextCursor });
}
