import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixOrganizationItem } from '@/lib/wixOrganizationMapper';
import { mockOrganizationFixtures } from '@/services/__mocks__/authFixtures';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';

/**
 * Phase 15A (Wix Organization Read Integration). Replaces the mock-only
 * organization READ path with a real Wix Data read, while every other
 * service (cases, tasks, staff, workflow templates) stays entirely on
 * mocks — see docs/adr/ADR-010-wix-organization-read-integration.md.
 *
 * In mock mode: reads services/__mocks__/authFixtures.ts's
 * mockOrganizationFixtures directly — byte-for-byte the same lookup the
 * old getMockOrganizationName() helper did, just returning the full
 * Organization object instead of a name string.
 *
 * In wix mode: queries the real `organizations` Wix Data collection
 * (created in Phase 14A, seeded in Phase 14B) for the item whose
 * `beaconOrganizationId` field matches the requested organizationId via
 * lib/wixDataApi.ts's direct REST call (not the @wix/data SDK module —
 * see lib/wixClient.ts's comment for why), and maps it through
 * lib/wixOrganizationMapper.ts's mapWixOrganizationItem — the one place a
 * raw Wix item shape is ever touched. Callers
 * (services/organizationsService.ts, and everything above it) only ever
 * see the same Organization domain type mock mode already returned.
 *
 * Phase 15X (Multi-Tenant Authorization Hardening): the path's
 * `organizationId` is untrusted input like any other Route Handler
 * parameter — requireAuthorizedOrganization re-derives it from the
 * caller's own session/membership before it's used for anything below,
 * closing the gap formerly documented in docs/AUTHENTICATION.md's "Known
 * limitations" and docs/ROADMAP.md.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId: requestedOrganizationId } = await params;

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const adapter = getDataAdapterMode();

  if (adapter === 'mock') {
    const organization = mockOrganizationFixtures.find((org) => org.id === organizationId) ?? null;
    if (!organization) {
      return NextResponse.json({ organization: null }, { status: 404 });
    }
    return NextResponse.json({ organization });
  }

  try {
    const response = await queryWixDataItems('organizations', {
      filter: { beaconOrganizationId: organizationId },
      paging: { limit: 1 },
    });

    const organization = mapWixOrganizationItem(response.dataItems[0]?.data);
    if (!organization) {
      return NextResponse.json({ organization: null }, { status: 404 });
    }
    return NextResponse.json({ organization });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ organization: null, error: message }, { status: 503 });
  }
}
