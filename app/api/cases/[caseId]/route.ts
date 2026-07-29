import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems, updateWixDataItem } from '@/lib/wixDataApi';
import { mapWixCaseItem, validateAndPickCaseUpdate, applyCaseUpdateToWixData, type WixCaseItem } from '@/lib/wixCaseMapper';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { findForbiddenPaymentFields } from '@/lib/paymentFieldGuard';
import { recordCaseUpdated, recordStageChanged, type FieldChange } from '@/services/activityService';
import { STAGES, toDisplayStage } from '@/domain/cases/stages';

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
function stageLabel(rawStage: number): string {
  return STAGES[toDisplayStage(rawStage)] ?? `Stage ${rawStage}`;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  // Phase 24: one correlationId per request, shared by every activity event
  // this single PATCH may produce (e.g. a stage change alongside other
  // field edits in the same call).
  const correlationId = crypto.randomUUID();

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

  // Phase 19A (Secure Payment Architecture): mandatory server-side
  // enforcement, checked before anything else — both the top-level body
  // and the nested `patch` object are checked, since a forged update could
  // try either shape. See docs/adr/ADR-021-secure-payment-architecture.md.
  const forbiddenPaymentFields = [...findForbiddenPaymentFields(b), ...findForbiddenPaymentFields(b.patch)];
  if (forbiddenPaymentFields.length > 0) {
    return NextResponse.json(
      {
        case: null,
        error: `Request must not contain payment card data (found: ${[...new Set(forbiddenPaymentFields)].join(', ')}).`,
      },
      { status: 400 },
    );
  }

  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ case: null, error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId } = authResult.context;
  const context = authResult.context;

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
    const existing = existingItem ? mapWixCaseItem(existingItem.data) : null;
    if (!existingItem || !existing) {
      return NextResponse.json({ case: null }, { status: 404 });
    }

    const mergedData = applyCaseUpdateToWixData(existingItem.data, patch);
    const updated = await updateWixDataItem<WixCaseItem>('cases', existingItem.id, mergedData);
    const result = mapWixCaseItem(updated.data);
    if (!result) {
      return NextResponse.json({ case: null, error: 'Failed to update case.' }, { status: 500 });
    }

    // Phase 24: best-effort — never fails the actual update. A stage
    // change gets its own, more specific event; every other changed field
    // is grouped into one case.updated event carrying only the fields that
    // actually changed (never a full case snapshot) — both share this
    // request's single correlationId.
    try {
      const activityCtx = { organizationId, actorIdentityId: context.userId, actorMembershipId: null, actorRoleKey: context.role, correlationId };
      const patchRecord = patch as Record<string, unknown>;
      const existingRecord = existing as unknown as Record<string, unknown>;

      if (patchRecord.rawStage !== undefined && patchRecord.rawStage !== existing.rawStage) {
        await recordStageChanged(activityCtx, caseId, stageLabel(existing.rawStage), stageLabel(patchRecord.rawStage as number), 'wix');
      }

      const changedFields: Record<string, FieldChange> = {};
      for (const key of Object.keys(patchRecord)) {
        if (key === 'rawStage') continue;
        const previous = existingRecord[key];
        const next = patchRecord[key];
        if (previous !== next) changedFields[key] = { previous, next };
      }
      if (Object.keys(changedFields).length > 0) {
        await recordCaseUpdated(activityCtx, caseId, changedFields, 'wix');
      }
    } catch (error) {
      console.error('Failed to record case-update activity event(s):', error instanceof Error ? error.message : error);
    }

    return NextResponse.json({ case: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ case: null, error: message }, { status: 503 });
  }
}
