import { NextResponse } from 'next/server';
import { requireFamilyAccess } from '@/lib/auth/requireFamilyAccess';
import { listFamilyActivity } from '@/services/portal/portalActivityView';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * Phase 29 (Family Portal & External Collaboration). Requires
 * `case.timeline.read`. Never the full per-case event stream — every
 * page is filtered to `FAMILY_VISIBLE_EVENT_TYPES` by
 * `portalActivityView.ts` before it ever reaches this response.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const accessResult = await requireFamilyAccess(caseId, 'case.timeline.read');
  if (!accessResult.authorized) return accessResult.response;

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const requestedLimit = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  const result = await listFamilyActivity(accessResult.organizationId, accessResult.caseId, cursor, limit, accessResult.dataAdapterMode);
  return NextResponse.json(result);
}
