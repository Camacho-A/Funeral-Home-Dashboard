import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems, updateWixDataItem } from '@/lib/wixDataApi';
import { mapWixCaseItem, validateAndPickCaseUpdate, applyCaseUpdateToWixData, type WixCaseItem } from '@/lib/wixCaseMapper';
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

/**
 * Phase 16 (Wix Write Integration). Updates an existing case in Wix — see
 * docs/adr/ADR-016-wix-write-integration.md.
 *
 * Requires DATA_ADAPTER=wix (mock-mode updates stay on
 * casesService.update's existing client-side path, which never calls this
 * route). organizationId in the body is only a requested value, re-derived
 * via requireAuthorizedOrganization exactly like every other route. The
 * patch itself is validated and allowlisted by
 * lib/wixCaseMapper.ts's validateAndPickCaseUpdate — an unknown or
 * immutable field (organizationId, workflowTemplateId, intakeOwnerId,
 * createdBy, ...) is silently dropped from the patch even if present in
 * the body, never applied; a *present but wrong-typed* field is rejected
 * with 400 instead.
 *
 * The case is first re-fetched by {beaconCaseId, organizationId} — this is
 * both the tenant-ownership check (a case belonging to another
 * organization is indistinguishable from "not found", 404, never a
 * different error) and how the full existing Wix data is obtained, since
 * Wix's updateDataItem is a full replace (see lib/wixDataApi.ts's
 * updateWixDataItem comment) — the validated patch is merged onto that
 * full object, never sent as a bare partial.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ case: null, error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ case: null, error: 'Invalid request body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ case: null, error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;

  if (getDataAdapterMode() !== 'wix') {
    return NextResponse.json(
      { case: null, error: 'This endpoint requires DATA_ADAPTER=wix.' },
      { status: 400 },
    );
  }

  const { patch, errors } = validateAndPickCaseUpdate(b.patch);
  if (errors.length > 0) {
    return NextResponse.json({ case: null, error: `Invalid field(s): ${errors.join(', ')}` }, { status: 400 });
  }

  try {
    const existingResponse = await queryWixDataItems<WixCaseItem>('cases', {
      filter: { beaconCaseId: caseId, organizationId, isArchived: false },
      paging: { limit: 1 },
    });
    const existingItem = existingResponse.dataItems[0];
    if (!existingItem || !mapWixCaseItem(existingItem.data)) {
      return NextResponse.json({ case: null }, { status: 404 });
    }

    const mergedData = applyCaseUpdateToWixData(existingItem.data, patch);
    const updated = await updateWixDataItem<WixCaseItem>('cases', existingItem.id, mergedData);
    const result = mapWixCaseItem(updated.data);
    if (!result) {
      return NextResponse.json({ case: null, error: 'Failed to update case.' }, { status: 500 });
    }

    return NextResponse.json({ case: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ case: null, error: message }, { status: 503 });
  }
}
