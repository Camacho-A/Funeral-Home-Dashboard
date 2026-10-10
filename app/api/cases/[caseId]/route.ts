import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { queryWixDataItems, updateWixDataItem } from '@/lib/wixDataApi';
import { mapWixCaseItem, validateAndPickCaseUpdate, applyCaseUpdateToWixData, type WixCaseItem } from '@/lib/wixCaseMapper';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { assertAssignableStaffProfile, assertStaffProfileIsActiveAndInOrganization, resolveStaffProfileForCaller, StaffAssignmentError } from '@/services/staffProfileService';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { findForbiddenPaymentFields } from '@/lib/paymentFieldGuard';
import {
  recordCaseUpdated,
  recordStageChanged,
  recordReturnMethodChanged,
  recordShipmentRecorded,
  recordShipmentTrackingNumberChanged,
  recordShipmentDelivered,
  recordContactRestrictionChanged,
  recordCaseArchiveChanged,
  type FieldChange,
} from '@/services/activityService';
import { STAGES, toDisplayStage } from '@/domain/cases/stages';
import { canReadCases, canEditCase, canReadPickup, canUpdatePickup } from '@/services/authorizationPolicyService';
import type { ReturnMethod } from '@/types/case';
import { toPickupOnlyView, PICKUP_ONLY_PATCH_FIELDS } from '@/domain/cases/pickupView';
import { assertValidPickupReleasePatch } from '@/domain/cases/pickupRelease';
import { getOrganization } from '@/services/organizationProvisioningService';
import { getDateOfBirthFutureError, getDateOfDeathFutureError, getFutureDateError, resolveOrgLocalToday } from '@/utils/inputMask';
import { reconcileCaseWorkflow } from '@/services/workflowReconciliationService';
import { syncExpectedPickupForCase } from '@/services/cremainsPickupService';
import { findInvalidChecklistStatePatchEntries } from '@/domain/workflow/checklistItemKey';

/**
 * Phase 15C (Wix Case Read Integration). Retrieves one case by its Solis
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
  const { organizationId, userId, role } = authResult.context;

  const adapter = getDataAdapterMode();
  const policyParams = { identityId: userId, organizationId, roleKey: role };

  try {
    // Manors launch-prep (Dispatch role): a caller with only `pickup.read`
    // (never `case.read`) gets a redacted view instead of the full case —
    // see domain/cases/pickupView.ts's own comment.
    const [hasFullRead, hasPickupOnlyRead] = await Promise.all([
      canReadCases(policyParams, adapter),
      canReadPickup(policyParams, adapter),
    ]);
    if (!hasFullRead && !hasPickupOnlyRead) {
      return NextResponse.json({ case: null, error: 'Not authorized to view this case.' }, { status: 403 });
    }

    if (adapter === 'mock') {
      const found =
        caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted) ?? null;
      if (!found) {
        return NextResponse.json({ case: null }, { status: 404 });
      }
      return NextResponse.json({ case: hasFullRead ? found : toPickupOnlyView(found) });
    }

    const response = await queryWixDataItems<WixCaseItem>('cases', {
      filter: { beaconCaseId: caseId, organizationId, isArchived: false },
      paging: { limit: 1 },
    });

    const found = mapWixCaseItem(response.dataItems[0]?.data);
    if (!found) {
      return NextResponse.json({ case: null }, { status: 404 });
    }
    return NextResponse.json({ case: hasFullRead ? found : toPickupOnlyView(found) });
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

  // Manors launch-prep (Dispatch role): `case.update` may patch anything;
  // a caller with only `pickup.update` may patch only the pickup fields —
  // see domain/cases/pickupView.ts's own comment. Checked against the
  // already-validated/allowlisted `patch` object (not the raw body), so a
  // caller can never smuggle a non-pickup field in under a pickup key.
  const policyParams = { identityId: context.userId, organizationId, roleKey: context.role };
  const [hasFullEdit, hasPickupOnlyEdit] = await Promise.all([
    canEditCase(policyParams, 'wix'),
    canUpdatePickup(policyParams, 'wix'),
  ]);
  if (!hasFullEdit && !hasPickupOnlyEdit) {
    return NextResponse.json({ case: null, error: 'Not authorized to update this case.' }, { status: 403 });
  }
  if (!hasFullEdit) {
    const patchKeys = Object.keys(patch);
    const disallowed = patchKeys.filter((key) => !(PICKUP_ONLY_PATCH_FIELDS as readonly string[]).includes(key));
    if (disallowed.length > 0) {
      return NextResponse.json(
        { case: null, error: `Not authorized to update field(s): ${disallowed.join(', ')}` },
        { status: 403 },
      );
    }
  }

  // Phase 30 (Identity Model Hardening & Staff Assignment Unification): a
  // reassignment (a non-null string, not an unassign-to-null patch) is
  // validated before it ever reaches Wix — never a phantom/inactive/
  // cross-org StaffProfile.id.
  //
  // Manors go-live fix (2026-09): assigning the case to YOURSELF only
  // needs the existence/active/org-match check (already covered by the
  // blanket case.update/pickup.update gate above for the rest of the
  // patch) — naming a DIFFERENT staff member additionally requires the
  // narrower case.reassign permission. Office Staff holds case.update but
  // not case.reassign, so they can edit a case's other fields and even
  // claim it for themselves, but cannot hand it to someone else.
  if (typeof patch.assignedStaffId === 'string') {
    try {
      const callerProfile = await resolveStaffProfileForCaller({ userId: context.userId, organizationId, role: context.role }, 'wix');
      if (callerProfile && patch.assignedStaffId === callerProfile.id) {
        await assertStaffProfileIsActiveAndInOrganization(organizationId, patch.assignedStaffId, 'wix');
      } else {
        await assertAssignableStaffProfile(
          { organizationId, staffProfileId: patch.assignedStaffId, permission: 'case.reassign', actor: { identityId: context.userId, organizationId, roleKey: context.role } },
          'wix',
        );
      }
    } catch (error) {
      const message = error instanceof StaffAssignmentError ? error.message : 'Failed to validate assignedStaffId.';
      return NextResponse.json({ case: null, error: message }, { status: 422 });
    }
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

    // Staff-facing terminology (2026-09): a case may never persist
    // pickupStatus === 'released' ("Family Picked Up") without a valid
    // Released To and Released Date — see domain/cases/pickupRelease.ts's
    // own comment. Checked against the full existing record merged with the
    // patch, so this also catches a patch that would clear an
    // already-released case's detail fields back to blank, not just the
    // initial transition into 'released'.
    try {
      assertValidPickupReleasePatch(existing, patch);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid pickup release patch.';
      return NextResponse.json({ case: null, error: message }, { status: 422 });
    }

    // B2026-035 hardening (2026-10): no write path may introduce a new
    // ambiguous bare-index checklist key — see
    // domain/workflow/checklistItemKey.ts#findInvalidChecklistStatePatchEntries's
    // own comment for exactly which entries this checks (only new/changed
    // ones, never an unchanged legacy key merely carried forward). Checked
    // before any mutation, so an invalid patch never touches the case.
    if (patch.checklistState) {
      const invalidEntries = findInvalidChecklistStatePatchEntries(existing.checklistState, patch.checklistState, existing.workflowSnapshot);
      if (invalidEntries.length > 0) {
        return NextResponse.json(
          { case: null, error: `Invalid checklist state: ${invalidEntries.map((e) => `"${e.key}" (${e.reason})`).join('; ')}` },
          { status: 400 },
        );
      }
    }

    // Task #15 (2026-09, future-historical-date validation): only checks a
    // field this patch actually sets — an already-persisted, untouched
    // value (however it got there) is never re-validated by an unrelated
    // edit, per "leave existing records untouched unless the user edits
    // the relevant field." "Today" is the organization's own local
    // calendar day (resolveOrgLocalToday), same authoritative source as
    // case-number year rollover; only fetched when a relevant field is
    // actually part of this patch.
    const dateFieldsInPatch: Array<[string, string]> = [
      ['dateOfBirth', 'Date of Birth'],
      ['dateOfDeath', 'Date of Death'],
      ['pickupReleasedAt', 'Released date'],
      ['shippingDateShipped', 'Date shipped'],
      ['shippingDeliveredAt', 'Delivered date'],
    ].filter(([key]) => typeof (patch as Record<string, unknown>)[key] === 'string') as Array<[string, string]>;
    if (dateFieldsInPatch.length > 0) {
      const organization = await getOrganization(organizationId, 'wix');
      const orgToday = resolveOrgLocalToday(new Date().toISOString(), organization?.timezone);
      for (const [key, label] of dateFieldsInPatch) {
        const value = (patch as Record<string, unknown>)[key] as string;
        const error =
          key === 'dateOfBirth'
            ? getDateOfBirthFutureError(value, orgToday)
            : key === 'dateOfDeath'
              ? getDateOfDeathFutureError(value, orgToday)
              : getFutureDateError(value, label, orgToday);
        if (error) {
          return NextResponse.json({ case: null, error }, { status: 422 });
        }
      }
    }

    const mergedData = applyCaseUpdateToWixData(existingItem.data, patch);
    const updated = await updateWixDataItem<WixCaseItem>('cases', existingItem.id, mergedData);
    let result = mapWixCaseItem(updated.data);
    if (!result) {
      return NextResponse.json({ case: null, error: 'Failed to update case.' }, { status: 500 });
    }

    // Task #6 (2026-09, checklist completion → workflow reconciliation).
    // A checklistState-only patch (the normal checkbox-toggle path) never
    // itself carries a rawStage change, so it never triggered
    // reconcileCaseWorkflow — meaning a case whose current stage's
    // checklist just became fully complete (e.g. the last item in a
    // stage) never advanced past it; it sat there showing "Review case"
    // (domain/cases/viewModel.ts's own fallback nextActionLabel, not a
    // real stage) until something ELSE happened to independently trigger
    // reconciliation. Reusing the exact existing
    // reconcileCaseWorkflow/computeFirstIncompleteRawStage logic already
    // used by the CaseFormLink-linking and payment-workflow paths —
    // never a second stage-calculation implementation — scoped
    // specifically to checklistState patches so every other Case edit
    // (Weight, NOK, Owner, ...) is completely unaffected.
    //
    // Runs AFTER the checklist patch above has actually persisted, so it
    // evaluates the new checklist state — and, critically, its result is
    // folded into `result` (the object this response returns) before
    // NextResponse.json below, so the client's optimistic-update cache
    // write (hooks/useCaseMutations.ts) receives the already-advanced
    // rawStage in this same response, rather than a stale value that
    // would only self-correct on some later, unrelated refetch.
    // Best-effort: a reconciliation failure never fails the checklist
    // update that already succeeded.
    if (patch.checklistState) {
      try {
        const reconcileResult = await reconcileCaseWorkflow(organizationId, caseId, 'wix');
        if (reconcileResult.changed) {
          result = { ...result, rawStage: reconcileResult.rawStage };
        }
      } catch (error) {
        console.error('Failed to reconcile workflow after checklist update:', error instanceof Error ? error.message : error);
      }

      // Expected Cremains Pickup (2026-10). The crematory-paperwork TASK
      // completing is what schedules a pickup — never entering the stage —
      // so this hangs off the checklist write path, the canonical place a
      // task is actually completed, and runs AFTER the patch has persisted
      // so it evaluates the new checklist state.
      //
      // "Now" is the completion timestamp: this executes in the same
      // request that just persisted the checkbox, so it is the actual
      // moment the task was completed, not a case/stage/death date.
      //
      // Idempotent by construction (deterministic case-scoped appointment
      // id), so a repeated save, retry or refresh cannot duplicate.
      // Best-effort, exactly like reconciliation above: a scheduling
      // failure never fails the checklist update that already succeeded.
      try {
        const organization = await getOrganization(organizationId, 'wix');
        await syncExpectedPickupForCase(
          {
            case_: result,
            organization: organization
              ? { id: organization.id, timezone: organization.timezone, cremainsPickupSettings: organization.cremainsPickupSettings }
              : null,
            paperworkCompletedAt: new Date().toISOString(),
          },
          { organizationId, actorIdentityId: context.userId, actorMembershipId: null, actorRoleKey: context.role, correlationId },
          'wix',
        );
      } catch (error) {
        console.error(
          'Failed to sync the expected cremains pickup after checklist update:',
          error instanceof Error ? error.message : error,
        );
      }
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

      // Conditional shipping/tracking (2026-09): returnMethod and the five
      // shipping fields get their own specific, human-readable events
      // (mirroring recordStageChanged's convention) instead of falling into
      // the generic "Case updated (...)" bucket — see
      // services/activityService.ts's recorder functions for the exact
      // wording. Excluded from the generic changedFields sweep below so
      // neither fires twice for the same change.
      if (patchRecord.returnMethod !== undefined && patchRecord.returnMethod !== existing.returnMethod) {
        await recordReturnMethodChanged(activityCtx, caseId, existing.returnMethod, patchRecord.returnMethod as ReturnMethod, 'wix');
      }
      if (
        patchRecord.shippingCarrier !== undefined &&
        patchRecord.shippingCarrier !== existing.shippingCarrier &&
        typeof patchRecord.shippingCarrier === 'string' &&
        patchRecord.shippingCarrier.trim() !== ''
      ) {
        await recordShipmentRecorded(activityCtx, caseId, patchRecord.shippingCarrier, 'wix');
      }
      if (
        patchRecord.shippingTrackingNumber !== undefined &&
        patchRecord.shippingTrackingNumber !== existing.shippingTrackingNumber &&
        typeof patchRecord.shippingTrackingNumber === 'string' &&
        patchRecord.shippingTrackingNumber.trim() !== ''
      ) {
        await recordShipmentTrackingNumberChanged(activityCtx, caseId, existing.shippingTrackingNumber ? 'updated' : 'added', 'wix');
      }
      if (
        patchRecord.shippingDeliveryStatus !== undefined &&
        patchRecord.shippingDeliveryStatus === 'delivered' &&
        existing.shippingDeliveryStatus !== 'delivered'
      ) {
        await recordShipmentDelivered(activityCtx, caseId, 'wix');
      }

      // Contact instructions (2026-10). Compared against the existing
      // value coerced to a boolean, so a legacy case whose column is
      // absent (undefined) correctly reads as "not restricted" and the
      // first time staff tick the box registers as a real change rather
      // than as undefined !== false noise.
      // Archived Cases (2026-10). Compared against the existing value
      // coerced to a boolean so a legacy row with the column absent reads
      // as "active", and the first archive registers as a real change.
      if (patchRecord.isDeleted !== undefined) {
        const wasArchived = existing.isDeleted === true;
        const nowArchived = patchRecord.isDeleted === true;
        if (wasArchived !== nowArchived) {
          await recordCaseArchiveChanged(activityCtx, caseId, nowArchived, 'wix');
        }
      }

      if (patchRecord.doNotContactNextOfKin !== undefined) {
        const wasRestricted = existing.doNotContactNextOfKin === true;
        const nowRestricted = patchRecord.doNotContactNextOfKin === true;
        if (wasRestricted !== nowRestricted) {
          await recordContactRestrictionChanged(activityCtx, caseId, nowRestricted, 'wix');
        }
      }

      const SHIPPING_EVENT_FIELDS = new Set([
        'rawStage',
        'returnMethod',
        'shippingCarrier',
        'shippingTrackingNumber',
        'shippingDateShipped',
        'shippingDeliveryStatus',
        'shippingDeliveredAt',
        // Has its own event immediately above; listed here so one change
        // never produces two audit entries.
        'doNotContactNextOfKin',
        // Has its own archived/restored event immediately above.
        'isDeleted',
      ]);
      const changedFields: Record<string, FieldChange> = {};
      for (const key of Object.keys(patchRecord)) {
        if (SHIPPING_EVENT_FIELDS.has(key)) continue;
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

    return NextResponse.json({ case: hasFullEdit ? result : toPickupOnlyView(result) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ case: null, error: message }, { status: 503 });
  }
}
