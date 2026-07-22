import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';

/**
 * Phase 15C (Wix Case Read Integration). Retrieves one case by its Beacon
 * domain id, scoped by organizationId — a case whose id matches but whose
 * organizationId doesn't is treated identically to "not found" (404),
 * mirroring app/api/workflow-templates/[templateId]/route.ts exactly.
 *
 * Phase 15X (Multi-Tenant Authorization Hardening): organizationId is
 * re-derived from the caller's session/membership before use — see
 * lib/auth/requireAuthorizedOrganization.ts.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const requestedOrganizationId = new URL(request.url).searchParams.get('organizationId');
  if (!requestedOrganizationId) {
    return NextResponse.json({ case: null, error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const adapter = getDataAdapterMode();

  if (adapter === 'mock') {
    const found =
      caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted) ?? null;
    if (!found) {
      return NextResponse.json({ case: null }, { status: 404 });
    }
    return NextResponse.json({ case: found });
  }

  try {
    const response = await queryWixDataItems<WixCaseItem>('cases', {
      filter: { beaconCaseId: caseId, organizationId, isArchived: false },
      paging: { limit: 1 },
    });

    const found = mapWixCaseItem(response.dataItems[0]?.data);
    if (!found) {
      return NextResponse.json({ case: null }, { status: 404 });
    }
    return NextResponse.json({ case: found });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ case: null, error: message }, { status: 503 });
  }
}
