import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { matchesSearch } from '@/services/casesService';
import type { Case } from '@/types/case';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';

/**
 * Phase 15C (Wix Case Read Integration). Lists cases for one organization
 * — see docs/adr/ADR-013-wix-case-read-integration.md.
 *
 * In mock mode: filters services/__mocks__/fixtures.ts's caseFixtures by
 * organizationId (excluding soft-deleted) plus the optional search query —
 * byte-for-byte the same logic services/casesService.ts's list() always
 * ran. In practice, `casesService.list()` never actually calls this route
 * while dataAdapterMode is "mock" (it takes a local, zero-network path
 * instead, to stay consistent with create()/update()'s client-side
 * fixture mutations — see ADR-013) — this branch exists for defense-in-
 * depth and independent testability, matching every other Phase 15
 * Route Handler's symmetric mock/wix shape.
 *
 * In wix mode: queries the `cases` collection filtered by organizationId
 * and isArchived=false, maps each item via lib/wixCaseMapper.ts (skipping
 * malformed records rather than throwing), then applies the same search
 * filter server-side.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  const searchQuery = url.searchParams.get('searchQuery') ?? '';

  if (!requestedOrganizationId) {
    return NextResponse.json({ cases: [], error: 'organizationId is required.' }, { status: 400 });
  }

  // Phase 15X (Multi-Tenant Authorization Hardening): re-derived from the
  // caller's session/membership, never trusted from the query param.
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  const adapter = getDataAdapterMode();

  if (adapter === 'mock') {
    const cases = caseFixtures.filter(
      (c) => c.organizationId === organizationId && !c.isDeleted && matchesSearch(c, searchQuery),
    );
    return NextResponse.json({ cases });
  }

  try {
    const response = await queryWixDataItems<WixCaseItem>('cases', {
      filter: { organizationId, isArchived: false },
    });

    const cases = response.dataItems
      .map((item) => mapWixCaseItem(item.data))
      .filter((c): c is Case => c !== null)
      .filter((c) => matchesSearch(c, searchQuery));

    return NextResponse.json({ cases });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ cases: [], error: message }, { status: 503 });
  }
}
