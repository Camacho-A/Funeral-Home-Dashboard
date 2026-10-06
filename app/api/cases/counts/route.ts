import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { countWixDataItems } from '@/lib/wixDataApi';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { buildCaseListWixFilter, buildCaseSearchWixFilter, matchesCaseSearch } from '@/lib/casePagination';
import { STAGES, rawStagesForDisplayStage } from '@/domain/cases/stages';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canReadCases, canReadPickup } from '@/services/authorizationPolicyService';

/**
 * Case list scalability, Phase 2 (2026-09). Efficient tab counts —
 * `{ total, byStage }`, `byStage` keyed by the exact
 * `domain/cases/stages.ts#STAGES` label strings (the same canonical
 * identifiers the list endpoint's own `stage` query param accepts), never
 * a separately-invented id a UI would have to map back to a display
 * string. "All Cases" is never a persisted stage — it's the separate
 * `total` field, not an entry in `byStage`.
 *
 * Search-aware (Phase 2 spec, "WITHOUT search: total org counts per
 * stage; WITH search: counts for the search result within each stage"):
 * an optional `searchQuery` narrows every count to cases matching it,
 * using the exact same `$startsWith`-based filter
 * GET /api/cases's bounded-page mode uses (`buildCaseSearchWixFilter`/
 * `matchesCaseSearch`) — see that module's own comment for why
 * `$startsWith`, not `.includes()`. This keeps counts and the
 * corresponding paginated list queries provably in agreement: both are
 * built from the identical `buildCaseListWixFilter` filter shape.
 *
 * Wix mode never downloads a single Case record to compute these: `total`
 * plus each of the 7 STAGES entries is one parallel call to Wix Data's
 * dedicated Count Data Items endpoint (`lib/wixDataApi.ts#countWixDataItems`
 * — `{ dataCollectionId, filter }` -> `{ totalCount }`, no item payload at
 * all) — 8 lightweight count-only requests per counts call, not 8
 * unrelated case-LIST requests, and not one query that fetches every
 * matching row merely to read `.length`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedOrganizationId = url.searchParams.get('organizationId');
  const searchQuery = url.searchParams.get('searchQuery') ?? '';

  if (!requestedOrganizationId) {
    return NextResponse.json({ total: 0, byStage: {}, error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;

  const adapter = getDataAdapterMode();
  const policyParams = { identityId: userId, organizationId, roleKey: role };

  try {
    // Same authorization gate as GET /api/cases's list — a pickup-only
    // reader sees redacted case rows on the list endpoint, never zero
    // rows, so they're equally entitled to the (non-sensitive) counts.
    const [hasFullRead, hasPickupOnlyRead] = await Promise.all([
      canReadCases(policyParams, adapter),
      canReadPickup(policyParams, adapter),
    ]);
    if (!hasFullRead && !hasPickupOnlyRead) {
      return NextResponse.json({ total: 0, byStage: {}, error: 'Not authorized to view cases for this organization.' }, { status: 403 });
    }

    if (adapter === 'mock') {
      const eligible = caseFixtures.filter(
        (c) => c.organizationId === organizationId && !c.isDeleted && matchesCaseSearch(c, searchQuery),
      );
      const byStage: Record<string, number> = {};
      STAGES.forEach((label, displayStage) => {
        const rawStages = rawStagesForDisplayStage(displayStage);
        byStage[label] = eligible.filter((c) => rawStages.includes(c.rawStage)).length;
      });
      return NextResponse.json({ total: eligible.length, byStage });
    }

    const searchFilter = buildCaseSearchWixFilter(searchQuery);
    const totalFilter = buildCaseListWixFilter({ organizationId, rawStages: null, searchFilter });
    const stageFilters = STAGES.map((_, displayStage) =>
      buildCaseListWixFilter({ organizationId, rawStages: rawStagesForDisplayStage(displayStage), searchFilter }),
    );

    const [total, ...stageCounts] = await Promise.all([
      countWixDataItems('cases', totalFilter),
      ...stageFilters.map((filter) => countWixDataItems('cases', filter)),
    ]);

    const byStage: Record<string, number> = {};
    STAGES.forEach((label, index) => {
      byStage[label] = stageCounts[index];
    });

    return NextResponse.json({ total, byStage });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ total: 0, byStage: {}, error: message }, { status: 503 });
  }
}
