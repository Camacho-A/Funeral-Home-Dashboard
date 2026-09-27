import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageRoles } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { getWixDataItemById, updateWixDataItem, WixDataApiError } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { recordCaseIncidentRecovery } from '@/services/activityService';
import type { CaseWorkflowSnapshot } from '@/types/workflowTemplate';

/**
 * B2026-034 incident recovery (2026-09) — a TEMPORARY, ADMIN-ONLY,
 * ONE-CASE endpoint. NOT a general-purpose Case editing endpoint — every
 * value it can ever write is a hardcoded, server-side literal below; the
 * request body supplies nothing but `organizationId` (used only to run the
 * standard authorization check, exactly like every other route in this
 * codebase).
 *
 * BACKGROUND: an earlier, direct Wix Data `PUT` (performed from this
 * session, outside of SOLIS itself) intended to patch only two fields on
 * this Case row (`fieldValues`, `workflowSnapshot`) but — because Wix's
 * `updateDataItem` fully replaces the item's `data` object rather than
 * merging into it (see `lib/wixDataApi.ts`'s `updateWixDataItem` comment)
 * — silently discarded every other business field on the row. This route
 * lets SOLIS's own server-side Wix access repair that specific row, using
 * a complete, hardcoded copy of the row's last-known-good pre-incident
 * state (captured by a full read performed immediately before the
 * destructive write) with exactly two intentional changes applied:
 *
 *   A. `fieldValues` backfilled at indices 0/1/2/4/7 (decedentName,
 *      placeOfDeath, dateOfBirth, dateOfDeath, "nextOfKinName —
 *      nextOfKinPhone") — indices 3/5/6 (weight, time of death, hospice/
 *      physician contact) deliberately left absent, matching every other
 *      historical-import case (see app/api/cases/historical-jotform-import/
 *      route.ts's own `fieldValues` construction).
 *   B. `workflowSnapshot`'s raw-stage-0 checklist indices 9 ("Credit card
 *      payment collected by phone") and 10 ("Payment receipt sent —
 *      confirms cleared to dispatch") corrected from `hasField: true` to
 *      `hasField: false` — the same manual-checklist-item fix already
 *      applied to the persisted `managed-cremations` workflow template
 *      (version 4) and to services/__mocks__/workflowTemplates.ts. Index 8
 *      ("Payment collected") was already `hasField: false` and is
 *      unchanged. `checklistState[8]` (the one real "is this case paid"
 *      flag) is restored to its original `true` value, exactly as
 *      captured — nothing here re-derives or re-computes payment state.
 *
 * Every other field is restored byte-for-byte from the captured
 * pre-incident record — no reconstruction from memory, no derivation from
 * another case, no fetch from Jotform, and workflowSnapshot is NOT
 * replaced with the newer workflow-template-standard-cremation-v4 (which
 * would rewrite this case's immutable point-in-time snapshot from a
 * template version this case was never created against).
 *
 * SCOPE GUARANTEES (see the constants and functions below for where each
 * is enforced):
 *   - Hard-scoped to exactly one Case row (`TARGET_CASE_WIX_ITEM_ID`) — no
 *     caseId, organizationId, or replacement data of any kind is ever
 *     accepted from the request body.
 *   - A precondition ("damaged-state fingerprint") is re-checked
 *     immediately before every write and again on every GET — a Case row
 *     that already has its core business fields (`caseNumber`,
 *     `organizationId`) present no longer matches the expected damaged
 *     state, so a second POST after a successful restoration is
 *     structurally a no-op (409, no write), making this operation
 *     one-time/idempotent from the incident's perspective.
 *   - No PII is ever logged, returned in a response, or written to the
 *     activity-event audit trail — every log/response/audit payload below
 *     carries only sanitized booleans, counts, and field *names* (never
 *     field *values*).
 *   - Never calls `reconcileCaseWorkflow`, never touches `caseSequences`,
 *     never fetches Jotform, never mutates a `CaseDocument`/payment/order
 *     row — this route imports none of the modules that could do any of
 *     those things.
 */

const MANORS_ORGANIZATION_ID = 'managed-cremations';

/** The Wix system `_id` of the damaged row — also its (now-missing)
    `beaconCaseId` value, since `cases` rows are inserted with `_id` set to
    their own `beaconCaseId` (see lib/wixDataApi.ts's `insertWixDataItem`
    comment). Fetched directly via `getWixDataItemById` rather than a
    `queryWixDataItems` filter, because the damaged row no longer carries
    any `data` field a filter could match on. */
const TARGET_CASE_WIX_ITEM_ID = '9d058cf4-9149-40ab-8c1c-4257a6c9b1f2';
const TARGET_CASE_NUMBER = 'B2026-034';

const RESTORED_FIELD_VALUES: Record<string, string> = {
  '0': 'LOUIS BARBER',
  '1': '7400 SW 11TH STREET',
  '2': '03/08/1982',
  '4': '08/15/2026',
  '7': 'TAINA LOPEZ — (954) 899-5296',
};

/** Byte-identical to workflow-template-standard-cremation version 3's own
    `intake` (confirmed by direct read earlier in this incident's
    investigation) — hardcoded here rather than imported from
    services/__mocks__/workflowTemplates.ts specifically so this recovery
    payload can never silently drift if that fixture is edited later for
    unrelated reasons. This is an immutable historical record, not a
    live-template reference. */
const RESTORED_INTAKE: CaseWorkflowSnapshot['intake'] = {
  sections: [
    {
      key: 'decedent',
      label: 'Decedent',
      fields: [
        {
          key: 'decedentName',
          label: 'Name of deceased',
          checklistItemIndex: 0,
          mapsToCaseField: 'decedentName',
          fieldType: 'text',
          uppercase: true,
          required: true,
        },
        {
          key: 'placeOfDeath',
          label: 'Place of death — name, address & phone number',
          checklistItemIndex: 1,
          mapsToCaseField: 'placeOfDeath',
          fieldType: 'text',
          uppercase: true,
        },
        {
          key: 'dateOfBirth',
          label: 'Date of birth',
          placeholder: 'MM/DD/YYYY',
          checklistItemIndex: 2,
          mapsToCaseField: 'dateOfBirth',
          fieldType: 'date',
          validationType: 'date',
        },
        {
          key: 'weight',
          label: 'Weight',
          placeholder: 'e.g. 165 lb',
          checklistItemIndex: 3,
          mapsToCaseField: 'weight',
          fieldType: 'text',
        },
        {
          key: 'dateOfDeath',
          label: 'Date of death',
          placeholder: 'MM/DD/YYYY',
          checklistItemIndex: 4,
          mapsToCaseField: 'dateOfDeath',
          fieldType: 'date',
          validationType: 'date',
        },
        {
          key: 'timeOfDeath',
          label: 'Time of death',
          placeholder: '24hr, e.g. 14:30',
          checklistItemIndex: 5,
          mapsToCaseField: 'timeOfDeath',
          fieldType: 'time',
        },
      ],
    },
    {
      key: 'contacts',
      label: 'Contacts',
      fields: [
        {
          key: 'dcContact',
          label: 'Hospice or physician to sign DC — name & phone number',
          checklistItemIndex: 6,
          fieldType: 'text',
          uppercase: true,
        },
        {
          key: 'nextOfKinName',
          label: 'Next of kin — name',
          checklistItemIndex: 7,
          mapsToCaseField: 'nextOfKinName',
          fieldType: 'text',
          uppercase: true,
        },
        {
          key: 'nextOfKinPhone',
          label: 'Next of kin — phone number',
          checklistItemIndex: 7,
          mapsToCaseField: 'nextOfKinPhone',
          fieldType: 'phone',
        },
      ],
    },
    {
      key: 'payment',
      label: 'Payment',
      fields: [
        {
          key: 'payment',
          label: 'Payment',
          fieldType: 'payment',
          paymentPurpose: 'Cremation service fee',
          paymentDescription: 'Collected securely via Clover once the case is created — not during intake.',
        },
      ],
    },
  ],
};

function stage0Or1Checklist(rawStage: 0 | 1) {
  const items = [
    { index: 0, label: 'Name of deceased', hasField: rawStage === 0, isPasswordField: false, externalFormIntegrationId: null },
    {
      index: 1,
      label: 'Place of death — name, address & phone number',
      hasField: rawStage === 0,
      isPasswordField: false,
      externalFormIntegrationId: null,
    },
    { index: 2, label: 'Date of birth', hasField: rawStage === 0, isPasswordField: false, externalFormIntegrationId: null },
    { index: 3, label: 'Weight', hasField: rawStage === 0, isPasswordField: false, externalFormIntegrationId: null },
    { index: 4, label: 'Date of death', hasField: rawStage === 0, isPasswordField: false, externalFormIntegrationId: null },
    { index: 5, label: 'Time of death', hasField: rawStage === 0, isPasswordField: false, externalFormIntegrationId: null },
    {
      index: 6,
      label: 'Hospice or physician who will sign the DC — name & phone number',
      hasField: rawStage === 0,
      isPasswordField: false,
      externalFormIntegrationId: null,
    },
    {
      index: 7,
      label: 'Family contact — name, phone number & email',
      hasField: rawStage === 0,
      isPasswordField: false,
      externalFormIntegrationId: null,
    },
    { index: 8, label: 'Payment collected', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
    // Manual-checklist-item fix (2026-09): indices 9/10 are plain checkbox
    // confirmations, never field-backed — the restored value here
    // (`false`), not the row's original, pre-fix `true`.
    {
      index: 9,
      label: 'Credit card payment collected by phone',
      hasField: false,
      isPasswordField: true,
      externalFormIntegrationId: null,
    },
    {
      index: 10,
      label: 'Payment receipt sent — confirms cleared to dispatch',
      hasField: false,
      isPasswordField: false,
      externalFormIntegrationId: null,
    },
  ];
  return { items };
}

const RESTORED_WORKFLOW_SNAPSHOT: CaseWorkflowSnapshot = {
  workflowTemplateId: 'workflow-template-standard-cremation',
  workflowTemplateVersion: 3,
  intake: RESTORED_INTAKE,
  stages: [
    { rawStage: 0, displayStage: 0, label: 'First Call & Payment', isAttentionStage: false, slaTargetDays: 0.25, checklist: stage0Or1Checklist(0) },
    { rawStage: 1, displayStage: 0, label: 'First Call & Payment', isAttentionStage: false, slaTargetDays: 0.25, checklist: stage0Or1Checklist(1) },
    {
      rawStage: 2,
      displayStage: 1,
      label: 'Jotform Application',
      isAttentionStage: false,
      slaTargetDays: 1,
      checklist: {
        items: [
          { index: 0, label: 'Jotform application completed', hasField: false, isPasswordField: false, externalFormIntegrationId: 'integration-jotform-managed-cremations' },
        ],
      },
    },
    {
      rawStage: 3,
      displayStage: 2,
      label: 'EDRS & Doctor / Cause of Death',
      isAttentionStage: true,
      slaTargetDays: 3,
      checklist: {
        items: [
          { index: 0, label: 'EDRS submitted & sent to doctor', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
          { index: 1, label: 'Cause of death entered', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
          { index: 2, label: 'Hardsave for state approval if not an online doctor', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
        ],
      },
    },
    {
      rawStage: 4,
      displayStage: 3,
      label: 'Permit & Authorization Sent to Crematory',
      isAttentionStage: false,
      slaTargetDays: 1,
      checklist: {
        items: [
          { index: 0, label: 'Permit sent to crematory', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
          { index: 1, label: 'Authorization of release sent to crematory', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
        ],
      },
    },
    {
      rawStage: 5,
      displayStage: 4,
      label: 'DC Application Sent',
      isAttentionStage: false,
      slaTargetDays: 2,
      checklist: {
        items: [
          { index: 0, label: 'DC application filled out', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
          { index: 1, label: 'Sent day before ashes arrive', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
        ],
      },
    },
    {
      rawStage: 6,
      displayStage: 5,
      label: 'Ready for Pickup / Contact Family',
      isAttentionStage: false,
      slaTargetDays: 4,
      checklist: {
        items: [
          { index: 0, label: 'Ashes picked up (Tue/Fri)', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
          { index: 1, label: 'Tag photo taken', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
          { index: 2, label: 'Tag/name/cert cross-checked', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
          { index: 3, label: 'Labels made', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
          { index: 4, label: 'Transferred to urn', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
          { index: 5, label: 'Family contacted — ashes ready for pickup', hasField: false, isPasswordField: false, externalFormIntegrationId: null },
        ],
      },
    },
    {
      rawStage: 7,
      displayStage: 6,
      label: 'Completed',
      isAttentionStage: false,
      slaTargetDays: null,
      checklist: {
        items: [{ index: 0, label: 'Family picked up ashes', hasField: false, isPasswordField: false, externalFormIntegrationId: null }],
      },
    },
  ],
};

/**
 * The complete restoration payload — every business field from the
 * captured last-known-good pre-incident record, with the two intended
 * repairs (fieldValues, workflowSnapshot indices 9/10) already applied.
 * `updateWixDataItem` sends this object as a full replacement of the Wix
 * item's `data` — never a partial patch (see that function's own comment;
 * a bare `{fieldValues, workflowSnapshot}` object is exactly what caused
 * the incident this route repairs).
 *
 * `vaNotificationResponsibility` is deliberately absent — the captured
 * pre-incident record never had this field set, and this restoration must
 * not fabricate a value the original row never had.
 */
const RESTORED_CASE_DATA: WixCaseItem = {
  beaconCaseId: TARGET_CASE_WIX_ITEM_ID,
  organizationId: MANORS_ORGANIZATION_ID,
  caseNumber: TARGET_CASE_NUMBER,
  caseType: 'cremation',
  workflowTemplateId: 'workflow-template-standard-cremation',
  workflowTemplateVersion: 3,
  workflowSnapshot: RESTORED_WORKFLOW_SNAPSHOT,
  intakeOwnerId: 'adf9b374-2216-44b9-8260-853ca01c482f',
  caseHandlerId: 'adf9b374-2216-44b9-8260-853ca01c482f',
  currentStage: 0,
  checklistState: { '8': true },
  fieldValues: RESTORED_FIELD_VALUES,
  decedentName: 'LOUIS BARBER',
  dateOfBirth: '03/08/1982',
  dateOfDeath: '08/15/2026',
  timeOfDeath: '—',
  placeOfDeath: '7400 SW 11TH STREET',
  weight: '—',
  nextOfKinName: 'TAINA LOPEZ',
  nextOfKinPhone: '(954) 899-5296',
  nextOfKinEmail: null,
  nextOfKinRelationship: 'spouse',
  nextOfKinRelationshipOther: null,
  tagNumber: null,
  paymentStatus: 'paid_in_full',
  pickupStatus: 'awaiting_pickup',
  pickupReleasedTo: null,
  pickupReleasedAt: null,
  pickupNote: null,
  returnMethod: 'pickup',
  shippingCarrier: null,
  shippingTrackingNumber: null,
  shippingDateShipped: null,
  shippingDeliveryStatus: null,
  shippingDeliveredAt: null,
  isVeteran: true,
  vaStepsState: { '0': true, '1': true, '2': true },
  vaPublishChoice: 'private',
  daysWaitingInStage: 0,
  isStalled: false,
  stalledReason: null,
  createdBy: 'adf9b374-2216-44b9-8260-853ca01c482f',
  isArchived: false,
  createdAt: '2026-09-25T18:27:23.891Z',
};

// ---------------------------------------------------------------------------
// Precondition — damaged-state fingerprint
// ---------------------------------------------------------------------------

type FingerprintResult = { matches: boolean; reason: string | null };

/**
 * The one-time/idempotency guard. A row that still has neither `caseNumber`
 * nor `organizationId` but does have `fieldValues`/`workflowSnapshot` is
 * exactly the shape the destructive write left behind. Once restored,
 * `caseNumber`/`organizationId` are present, so this check — re-run
 * immediately before every write — permanently fails closed afterward.
 */
function checkDamagedStateFingerprint(data: WixCaseItem | null): FingerprintResult {
  if (!data) {
    return { matches: false, reason: 'Case record not found.' };
  }
  const hasCaseNumber = typeof data.caseNumber === 'string' && data.caseNumber.length > 0;
  const hasOrganizationId = typeof data.organizationId === 'string' && data.organizationId.length > 0;
  const hasFieldValues = data.fieldValues !== undefined && data.fieldValues !== null;
  const hasWorkflowSnapshot = data.workflowSnapshot !== undefined && data.workflowSnapshot !== null;

  if (hasCaseNumber || hasOrganizationId) {
    return {
      matches: false,
      reason: 'Record already has core business fields (caseNumber/organizationId present) — does not match the expected damaged-state fingerprint. No write performed.',
    };
  }
  if (!hasFieldValues || !hasWorkflowSnapshot) {
    return {
      matches: false,
      reason: 'Record is missing fieldValues/workflowSnapshot — does not match the expected damaged-state fingerprint. No write performed.',
    };
  }
  return { matches: true, reason: null };
}

// ---------------------------------------------------------------------------
// Post-write verification — sanitized booleans/counts only, never PII
// ---------------------------------------------------------------------------

const EXPECTED_BUSINESS_FIELDS: (keyof WixCaseItem)[] = [
  'caseNumber',
  'organizationId',
  'currentStage',
  'checklistState',
  'decedentName',
  'placeOfDeath',
  'dateOfBirth',
  'dateOfDeath',
  'timeOfDeath',
  'weight',
  'nextOfKinName',
  'nextOfKinPhone',
  'nextOfKinEmail',
  'nextOfKinRelationship',
  'nextOfKinRelationshipOther',
  'paymentStatus',
  'isVeteran',
  'vaStepsState',
  'vaPublishChoice',
  'workflowTemplateId',
  'workflowTemplateVersion',
  'tagNumber',
  'caseHandlerId',
  'returnMethod',
  'isStalled',
  'stalledReason',
  'isArchived',
  'daysWaitingInStage',
  'pickupStatus',
  'pickupReleasedTo',
  'pickupReleasedAt',
  'pickupNote',
  'shippingDeliveryStatus',
  'shippingTrackingNumber',
  'shippingDateShipped',
  'shippingCarrier',
  'shippingDeliveredAt',
  'intakeOwnerId',
  'createdAt',
  'createdBy',
  'caseType',
  'beaconCaseId',
  'fieldValues',
  'workflowSnapshot',
];

type VerificationResult = {
  fullyRestored: boolean;
  mapsToValidCase: boolean;
  expectedBusinessFieldsPresent: boolean;
  /** Field NAMES only — never values. */
  missingFields: string[];
  fieldValuesRestored: {
    index0Populated: boolean;
    index1Populated: boolean;
    index2Populated: boolean;
    index3Absent: boolean;
    index4Populated: boolean;
    index5Absent: boolean;
    index6Absent: boolean;
    index7Populated: boolean;
  };
  workflowSnapshotChecklistRestored: {
    index8HasFieldFalse: boolean;
    index9HasFieldFalse: boolean;
    index10HasFieldFalse: boolean;
  };
  checklistState8True: boolean;
  caseNumberRestored: boolean;
  organizationIdRestored: boolean;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function verifyRestoration(data: WixCaseItem): VerificationResult {
  const missingFields = EXPECTED_BUSINESS_FIELDS.filter((key) => data[key] === undefined).map(String);
  const mapped = mapWixCaseItem(data);

  const fieldValues = (data.fieldValues && typeof data.fieldValues === 'object' ? data.fieldValues : {}) as Record<string, unknown>;
  const checklistState = (data.checklistState && typeof data.checklistState === 'object' ? data.checklistState : {}) as Record<string, unknown>;
  const snapshot = data.workflowSnapshot as CaseWorkflowSnapshot | undefined;
  const stage0Items = snapshot?.stages?.find((s) => s.rawStage === 0)?.checklist.items ?? [];
  const byIndex = (i: number) => stage0Items.find((item) => item.index === i);

  const fieldValuesRestored = {
    index0Populated: isNonEmptyString(fieldValues['0']),
    index1Populated: isNonEmptyString(fieldValues['1']),
    index2Populated: isNonEmptyString(fieldValues['2']),
    index3Absent: fieldValues['3'] === undefined,
    index4Populated: isNonEmptyString(fieldValues['4']),
    index5Absent: fieldValues['5'] === undefined,
    index6Absent: fieldValues['6'] === undefined,
    index7Populated: isNonEmptyString(fieldValues['7']),
  };
  const workflowSnapshotChecklistRestored = {
    index8HasFieldFalse: byIndex(8)?.hasField === false,
    index9HasFieldFalse: byIndex(9)?.hasField === false,
    index10HasFieldFalse: byIndex(10)?.hasField === false,
  };
  const checklistState8True = checklistState['8'] === true;
  const caseNumberRestored = data.caseNumber === TARGET_CASE_NUMBER;
  const organizationIdRestored = data.organizationId === MANORS_ORGANIZATION_ID;
  const expectedBusinessFieldsPresent = missingFields.length === 0;

  const fullyRestored =
    expectedBusinessFieldsPresent &&
    mapped !== null &&
    Object.values(fieldValuesRestored).every(Boolean) &&
    Object.values(workflowSnapshotChecklistRestored).every(Boolean) &&
    checklistState8True &&
    caseNumberRestored &&
    organizationIdRestored;

  return {
    fullyRestored,
    mapsToValidCase: mapped !== null,
    expectedBusinessFieldsPresent,
    missingFields,
    fieldValuesRestored,
    workflowSnapshotChecklistRestored,
    checklistState8True,
    caseNumberRestored,
    organizationIdRestored,
  };
}

// ---------------------------------------------------------------------------
// Shared authorization — Administrator only (user.manageRoles), Manors only
// ---------------------------------------------------------------------------

async function authorizeRequest(requestedOrganizationId: string) {
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) {
    return { ok: false as const, response: authResult.response };
  }
  const { organizationId, userId, role } = authResult.context;
  const mode = getDataAdapterMode();

  const isAdministrator = await canManageRoles({ identityId: userId, organizationId, roleKey: role }, mode);
  if (!isAdministrator) {
    return { ok: false as const, response: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }) };
  }
  if (organizationId !== MANORS_ORGANIZATION_ID) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'This action is only available for the Manors organization.' }, { status: 400 }),
    };
  }
  if (mode !== 'wix') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'This action only applies when DATA_ADAPTER=wix.' }, { status: 400 }),
    };
  }

  return { ok: true as const, organizationId, userId, role, mode };
}

/** GET — read-only eligibility check. Never mutates. Mirrors
    app/api/organization/case-sequence/manors-go-live-cutover/route.ts's
    own GET/POST split. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const auth = await authorizeRequest(organizationId);
  if (!auth.ok) return auth.response;

  const existing = await getWixDataItemById<WixCaseItem>('cases', TARGET_CASE_WIX_ITEM_ID);
  const fingerprint = checkDamagedStateFingerprint(existing?.data ?? null);

  return NextResponse.json({
    caseNumber: TARGET_CASE_NUMBER,
    matchesDamagedStateFingerprint: fingerprint.matches,
    reason: fingerprint.reason,
  });
}

/** POST — executes the restoration. Authorization + the damaged-state
    fingerprint are always re-verified here from scratch, never trusting an
    earlier GET. */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const auth = await authorizeRequest(b.organizationId);
  if (!auth.ok) return auth.response;
  const { organizationId, userId, role, mode } = auth;

  const correlationId = crypto.randomUUID();
  const activityCtx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId };

  // Immediate pre-mutation revalidation — never relies on an earlier GET,
  // which could be stale by the time the operator confirms.
  const existing = await getWixDataItemById<WixCaseItem>('cases', TARGET_CASE_WIX_ITEM_ID);
  const fingerprint = checkDamagedStateFingerprint(existing?.data ?? null);
  if (!fingerprint.matches) {
    return NextResponse.json(
      { error: fingerprint.reason ?? 'Record does not match the expected damaged-state fingerprint.', restored: false },
      { status: 409 },
    );
  }

  // The write — a complete, server-controlled, hardcoded replacement
  // object. Never a bare `{fieldValues, workflowSnapshot}` patch, which is
  // exactly what caused the incident this route repairs (see
  // lib/wixDataApi.ts's updateWixDataItem comment on Wix's full-replace
  // PUT semantics).
  let updated;
  try {
    updated = await updateWixDataItem<WixCaseItem>('cases', TARGET_CASE_WIX_ITEM_ID, RESTORED_CASE_DATA);
  } catch (error) {
    try {
      await recordCaseIncidentRecovery(activityCtx, TARGET_CASE_WIX_ITEM_ID, TARGET_CASE_NUMBER, 'failed', mode);
    } catch (auditError) {
      console.error('Failed to record incident-recovery (write-failure) activity event:', auditError instanceof Error ? auditError.message : auditError);
    }
    const message = error instanceof WixDataApiError ? error.message : 'Unknown error connecting to Wix.';
    return NextResponse.json({ error: message, restored: false }, { status: 503 });
  }

  const verification = verifyRestoration(updated.data);

  try {
    await recordCaseIncidentRecovery(activityCtx, TARGET_CASE_WIX_ITEM_ID, TARGET_CASE_NUMBER, verification.fullyRestored ? 'succeeded' : 'failed', mode);
  } catch (auditError) {
    console.error('Failed to record incident-recovery activity event:', auditError instanceof Error ? auditError.message : auditError);
  }

  return NextResponse.json({ restored: verification.fullyRestored, verification });
}
