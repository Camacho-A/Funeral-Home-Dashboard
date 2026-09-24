import type { Case, CaseUpdate, NextOfKinRelationship, PaymentStatus, PickupStatus, ReturnMethod, ShippingDeliveryStatus, VaPublishChoice } from '../types/case';
import type { CaseWorkflowSnapshot } from '../types/workflowTemplate';
import { isValidEmail } from '../utils/inputMask';
import { DEFAULT_RETURN_METHOD, isValidReturnMethod, isValidShippingDeliveryStatus } from '../domain/cases/returnMethod';
import { normalizeCaseTextFields, normalizeCaseFieldValues } from '../domain/cases/textNormalization';

/** Manors launch-prep. Mirrors lib/wixOrganizationMapper.ts's own
    VALID_STATUSES/isValidStatus local-guard convention exactly. */
export const NEXT_OF_KIN_RELATIONSHIP_VALUES: NextOfKinRelationship[] = [
  'spouse',
  'domestic_partner',
  'son',
  'daughter',
  'parent',
  'brother',
  'sister',
  'grandchild',
  'grandparent',
  'niece',
  'nephew',
  'other_relative',
  'friend',
  'legal_representative',
  'other',
];

export function isValidNextOfKinRelationship(value: unknown): value is NextOfKinRelationship {
  return typeof value === 'string' && (NEXT_OF_KIN_RELATIONSHIP_VALUES as string[]).includes(value);
}

/**
 * Phase 15C (Wix Case Read Integration). Mirrors lib/wixOrganizationMapper.ts
 * and lib/wixWorkflowTemplateMapper.ts's role exactly: the one place a raw
 * Wix `cases` collection item is ever touched. See
 * docs/adr/ADR-013-wix-case-read-integration.md.
 *
 * Identifier handling (documented per this phase's explicit requirement):
 * - Wix item `_id`: never read, never used as a Beacon id.
 * - `beaconCaseId` → Case.id.
 * - `organizationId` → Case.organizationId (unchanged name).
 * - `workflowTemplateId` → Case.workflowTemplateId (references
 *   workflowTemplates.beaconTemplateId — Phase 15B — but this mapper does
 *   not itself validate that reference exists; a case pointing at a
 *   missing/deleted template is still mapped, since resolving that
 *   reference is a domain/consumer concern, not this adapter boundary's).
 * - `workflowTemplateVersion` → Case.workflowTemplateVersion (a plain
 *   number matching the template version, not a separate "version ID" —
 *   see ADR-012: WorkflowTemplateVersion has no id of its own).
 * - `workflowSnapshot` → Case.workflowSnapshot, passed through unchanged
 *   (no re-derivation, no normalization) once confirmed to be a
 *   CaseWorkflowSnapshot-shaped object — preserving immutable-snapshot
 *   integrity is the whole point of this field.
 * - `caseHandlerId` → Case.assignedStaffId (RENAMED — matches
 *   docs/WIX_DATA_SCHEMA.md's Collection 5 mapping table exactly).
 * - `currentStage` → Case.rawStage (RENAMED).
 * - `isArchived` → Case.isDeleted (RENAMED).
 * - `caseNumber` → Case.caseNumber (unchanged name; Phase 16B — see
 *   docs/adr/ADR-018-case-number-generation.md). Server-generated only
 *   (lib/wixCaseNumberSequence.ts at creation time); this mapper only ever
 *   reads it, never derives or reformats it.
 * - `intakeOwnerId`/`createdBy` → same names, no rename — see
 *   docs/WIX_DATA_SCHEMA.md's "Open design decision" for the still-unresolved
 *   identity-space question (StaffProfile.id vs. authenticated-identity id);
 *   this mapper passes through whatever string Wix holds, unchanged, since
 *   resolving that fork is out of this phase's scope.
 * - Task relationships: none exist on `Case` itself — a case never
 *   references any task id; the reverse link (CaseTask.caseId) lives on
 *   the `tasks` collection, which this phase does not read at all
 *   (Phase 15D's explicit scope, not this one's).
 */

export type WixCaseItem = {
  beaconCaseId?: unknown;
  organizationId?: unknown;
  caseNumber?: unknown;
  caseType?: unknown;
  workflowTemplateId?: unknown;
  workflowTemplateVersion?: unknown;
  workflowSnapshot?: unknown;
  intakeOwnerId?: unknown;
  caseHandlerId?: unknown;
  currentStage?: unknown;
  checklistState?: unknown;
  fieldValues?: unknown;
  decedentName?: unknown;
  dateOfBirth?: unknown;
  dateOfDeath?: unknown;
  timeOfDeath?: unknown;
  placeOfDeath?: unknown;
  weight?: unknown;
  nextOfKinName?: unknown;
  nextOfKinPhone?: unknown;
  nextOfKinEmail?: unknown;
  nextOfKinRelationship?: unknown;
  nextOfKinRelationshipOther?: unknown;
  tagNumber?: unknown;
  paymentStatus?: unknown;
  pickupStatus?: unknown;
  pickupReleasedTo?: unknown;
  pickupReleasedAt?: unknown;
  pickupNote?: unknown;
  returnMethod?: unknown;
  shippingCarrier?: unknown;
  shippingTrackingNumber?: unknown;
  shippingDateShipped?: unknown;
  shippingDeliveryStatus?: unknown;
  shippingDeliveredAt?: unknown;
  isVeteran?: unknown;
  vaStepsState?: unknown;
  vaPublishChoice?: unknown;
  daysWaitingInStage?: unknown;
  isStalled?: unknown;
  stalledReason?: unknown;
  createdBy?: unknown;
  isArchived?: unknown;
  createdAt?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidWorkflowSnapshot(value: unknown): value is CaseWorkflowSnapshot {
  return (
    isPlainObject(value) &&
    typeof value.workflowTemplateId === 'string' &&
    typeof value.workflowTemplateVersion === 'number' &&
    Array.isArray(value.stages) &&
    isPlainObject(value.intake)
  );
}

/**
 * Validates and maps one `cases` Wix item into Beacon's Case domain type.
 * Returns null (skip, don't throw) if any required field is missing, the
 * wrong type, or the workflow snapshot isn't a usable object — a case
 * without a valid snapshot has nothing safe to render its stages/checklist
 * from, the same "application-integrity, fail-safe-not-broken" reasoning
 * ADR-012 already established for a workflow template with zero versions.
 * Optional/nullable fields (assignedStaffId, createdBy, intakeOwnerId,
 * vaPublishChoice, stalledReason) are allowed to be null but not the wrong
 * type if present.
 */
export function mapWixCaseItem(item: WixCaseItem | undefined): Case | null {
  if (
    !item ||
    typeof item.beaconCaseId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseNumber !== 'string' ||
    typeof item.caseType !== 'string' ||
    typeof item.workflowTemplateId !== 'string' ||
    typeof item.workflowTemplateVersion !== 'number' ||
    !isValidWorkflowSnapshot(item.workflowSnapshot) ||
    typeof item.currentStage !== 'number' ||
    !isPlainObject(item.checklistState) ||
    !isPlainObject(item.fieldValues) ||
    typeof item.decedentName !== 'string' ||
    typeof item.dateOfBirth !== 'string' ||
    typeof item.dateOfDeath !== 'string' ||
    typeof item.timeOfDeath !== 'string' ||
    typeof item.placeOfDeath !== 'string' ||
    typeof item.weight !== 'string' ||
    typeof item.nextOfKinName !== 'string' ||
    typeof item.nextOfKinPhone !== 'string' ||
    (item.paymentStatus !== 'awaiting_payment' && item.paymentStatus !== 'paid_in_full') ||
    typeof item.isVeteran !== 'boolean' ||
    typeof item.isArchived !== 'boolean' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  const intakeOwnerId = typeof item.intakeOwnerId === 'string' ? item.intakeOwnerId : null;
  const createdBy = typeof item.createdBy === 'string' ? item.createdBy : null;
  const assignedStaffId = typeof item.caseHandlerId === 'string' ? item.caseHandlerId : null;
  const vaPublishChoice: VaPublishChoice | null =
    item.vaPublishChoice === 'publish' || item.vaPublishChoice === 'private' ? item.vaPublishChoice : null;
  const stalledReason = typeof item.stalledReason === 'string' ? item.stalledReason : null;
  const tagNumber = typeof item.tagNumber === 'string' ? item.tagNumber : null;
  const nextOfKinEmail = typeof item.nextOfKinEmail === 'string' ? item.nextOfKinEmail : null;
  const nextOfKinRelationship = isValidNextOfKinRelationship(item.nextOfKinRelationship) ? item.nextOfKinRelationship : null;
  const nextOfKinRelationshipOther = typeof item.nextOfKinRelationshipOther === 'string' ? item.nextOfKinRelationshipOther : null;
  // Additive field — a pre-Manors-launch-prep row has no pickupStatus at
  // all, which must resolve to the same safe default a brand-new case
  // gets ('awaiting_pickup'), never null/undefined.
  const pickupStatus: PickupStatus = item.pickupStatus === 'released' ? 'released' : 'awaiting_pickup';
  const pickupReleasedTo = typeof item.pickupReleasedTo === 'string' ? item.pickupReleasedTo : null;
  const pickupReleasedAt = typeof item.pickupReleasedAt === 'string' ? item.pickupReleasedAt : null;
  const pickupNote = typeof item.pickupNote === 'string' ? item.pickupNote : null;
  // Conditional shipping/tracking (2026-09). Additive field — a pre-existing
  // row (or any legacy/malformed row) has no returnMethod at all, which must
  // resolve to 'undecided', never 'pickup' — see ReturnMethod's own comment
  // on why silently assuming pickup would misrepresent an undecided
  // family's actual state. Mirrors pickupStatus's own defensive-default
  // pattern immediately above.
  const returnMethod: ReturnMethod = isValidReturnMethod(item.returnMethod) ? item.returnMethod : DEFAULT_RETURN_METHOD;
  const shippingCarrier = typeof item.shippingCarrier === 'string' ? item.shippingCarrier : null;
  const shippingTrackingNumber = typeof item.shippingTrackingNumber === 'string' ? item.shippingTrackingNumber : null;
  const shippingDateShipped = typeof item.shippingDateShipped === 'string' ? item.shippingDateShipped : null;
  const shippingDeliveryStatus: ShippingDeliveryStatus | null = isValidShippingDeliveryStatus(item.shippingDeliveryStatus)
    ? item.shippingDeliveryStatus
    : null;
  const shippingDeliveredAt = typeof item.shippingDeliveredAt === 'string' ? item.shippingDeliveredAt : null;

  return {
    id: item.beaconCaseId,
    organizationId: item.organizationId,
    caseNumber: item.caseNumber,
    decedentName: item.decedentName,
    dateOfBirth: item.dateOfBirth,
    dateOfDeath: item.dateOfDeath,
    timeOfDeath: item.timeOfDeath,
    placeOfDeath: item.placeOfDeath,
    weight: item.weight,
    rawStage: item.currentStage,
    assignedStaffId,
    nextOfKinName: item.nextOfKinName,
    nextOfKinPhone: item.nextOfKinPhone,
    nextOfKinEmail,
    nextOfKinRelationship,
    nextOfKinRelationshipOther,
    tagNumber,
    paymentStatus: item.paymentStatus as PaymentStatus,
    pickupStatus,
    pickupReleasedTo,
    pickupReleasedAt,
    pickupNote,
    returnMethod,
    shippingCarrier,
    shippingTrackingNumber,
    shippingDateShipped,
    shippingDeliveryStatus,
    shippingDeliveredAt,
    isVeteran: item.isVeteran,
    vaStepsState: isPlainObject(item.vaStepsState) ? (item.vaStepsState as Record<number, boolean>) : {},
    vaPublishChoice,
    checklistState: item.checklistState as Record<number, boolean>,
    fieldValues: item.fieldValues as Record<number, string>,
    daysWaitingInStage: typeof item.daysWaitingInStage === 'number' ? item.daysWaitingInStage : 0,
    isStalled: typeof item.isStalled === 'boolean' ? item.isStalled : false,
    stalledReason,
    createdBy,
    intakeOwnerId,
    createdAt: item.createdAt,
    isDeleted: item.isArchived,
    workflowTemplateId: item.workflowTemplateId,
    workflowTemplateVersion: item.workflowTemplateVersion,
    caseType: item.caseType,
    workflowSnapshot: item.workflowSnapshot,
  };
}

/**
 * Solis go-live diagnostics (case-creation 500 investigation). `mapWixCaseItem`
 * fails closed by design — any type mismatch returns `null` with no reason,
 * which is correct for the read path but left the create path's "Failed to
 * create case." 500 branch with zero insight into *why* the just-inserted
 * item didn't round-trip. This mirrors the exact same required-field checks
 * for server-side logging only — never returned to the client, never called
 * from the read path.
 */
export function describeMapWixCaseItemFailure(item: WixCaseItem | undefined): string[] {
  if (!item) return ['item is missing/undefined'];
  const failures: string[] = [];
  const check = (condition: boolean, label: string) => {
    if (!condition) failures.push(label);
  };
  check(typeof item.beaconCaseId === 'string', `beaconCaseId: expected string, got ${typeof item.beaconCaseId}`);
  check(typeof item.organizationId === 'string', `organizationId: expected string, got ${typeof item.organizationId}`);
  check(typeof item.caseNumber === 'string', `caseNumber: expected string, got ${typeof item.caseNumber}`);
  check(typeof item.caseType === 'string', `caseType: expected string, got ${typeof item.caseType}`);
  check(typeof item.workflowTemplateId === 'string', `workflowTemplateId: expected string, got ${typeof item.workflowTemplateId}`);
  check(typeof item.workflowTemplateVersion === 'number', `workflowTemplateVersion: expected number, got ${typeof item.workflowTemplateVersion}`);
  check(isValidWorkflowSnapshot(item.workflowSnapshot), 'workflowSnapshot: invalid shape');
  check(typeof item.currentStage === 'number', `currentStage: expected number, got ${typeof item.currentStage}`);
  check(isPlainObject(item.checklistState), `checklistState: expected object, got ${typeof item.checklistState}`);
  check(isPlainObject(item.fieldValues), `fieldValues: expected object, got ${typeof item.fieldValues}`);
  check(typeof item.decedentName === 'string', `decedentName: expected string, got ${typeof item.decedentName}`);
  check(typeof item.dateOfBirth === 'string', `dateOfBirth: expected string, got ${typeof item.dateOfBirth}`);
  check(typeof item.dateOfDeath === 'string', `dateOfDeath: expected string, got ${typeof item.dateOfDeath}`);
  check(typeof item.timeOfDeath === 'string', `timeOfDeath: expected string, got ${typeof item.timeOfDeath}`);
  check(typeof item.placeOfDeath === 'string', `placeOfDeath: expected string, got ${typeof item.placeOfDeath}`);
  check(typeof item.weight === 'string', `weight: expected string, got ${typeof item.weight}`);
  check(typeof item.nextOfKinName === 'string', `nextOfKinName: expected string, got ${typeof item.nextOfKinName}`);
  check(typeof item.nextOfKinPhone === 'string', `nextOfKinPhone: expected string, got ${typeof item.nextOfKinPhone}`);
  check(
    item.paymentStatus === 'awaiting_payment' || item.paymentStatus === 'paid_in_full',
    `paymentStatus: expected 'awaiting_payment'|'paid_in_full', got ${JSON.stringify(item.paymentStatus)}`,
  );
  check(typeof item.isVeteran === 'boolean', `isVeteran: expected boolean, got ${typeof item.isVeteran}`);
  check(typeof item.isArchived === 'boolean', `isArchived: expected boolean, got ${typeof item.isArchived}`);
  check(typeof item.createdAt === 'string', `createdAt: expected string, got ${typeof item.createdAt}`);
  return failures;
}

/**
 * Phase 16 (Wix Write Integration). The inverse of mapWixCaseItem: builds a
 * complete `cases` Wix item's `data` object for insertion. Every field
 * here is either server-derived (organizationId from
 * requireAuthorizedOrganization, workflowTemplateId/Version/workflowSnapshot
 * from the server's own template resolution, createdAt from the server
 * clock) or comes from validated request-body input — never a raw,
 * unvalidated client value. See app/api/cases/route.ts's POST handler.
 */
export function buildWixCaseData(params: {
  beaconCaseId: string;
  organizationId: string;
  caseNumber: string;
  caseType: string;
  workflowTemplateId: string;
  workflowTemplateVersion: number;
  workflowSnapshot: CaseWorkflowSnapshot;
  intakeOwnerId: string;
  createdBy: string;
  assignedStaffId: string | null;
  decedentName: string;
  dateOfBirth: string;
  dateOfDeath: string;
  timeOfDeath: string;
  placeOfDeath: string;
  weight: string;
  nextOfKinName: string;
  nextOfKinPhone: string;
  nextOfKinEmail?: string | null;
  nextOfKinRelationship?: NextOfKinRelationship | null;
  nextOfKinRelationshipOther?: string | null;
  fieldValues: Record<number, string>;
  createdAt: string;
  /** Optional at creation — a family may not have decided yet. Omitted
      defaults to 'undecided', never 'pickup'. */
  returnMethod?: ReturnMethod;
}): WixCaseItem {
  // SOLIS-wide ALL-CAPS data standard (2026-09): the single authoritative
  // normalization point for a newly created case — applies regardless of
  // whether the caller is the New Case UI or any future direct API caller,
  // since this function is the only thing that ever builds a `cases` insert
  // payload (see app/api/cases/route.ts's POST handler, its sole caller).
  const normalized = normalizeCaseTextFields({
    decedentName: params.decedentName,
    placeOfDeath: params.placeOfDeath,
    nextOfKinName: params.nextOfKinName,
    nextOfKinRelationshipOther: params.nextOfKinRelationshipOther ?? null,
  });

  return {
    beaconCaseId: params.beaconCaseId,
    organizationId: params.organizationId,
    caseNumber: params.caseNumber,
    caseType: params.caseType,
    workflowTemplateId: params.workflowTemplateId,
    workflowTemplateVersion: params.workflowTemplateVersion,
    workflowSnapshot: params.workflowSnapshot,
    intakeOwnerId: params.intakeOwnerId,
    caseHandlerId: params.assignedStaffId,
    currentStage: 0,
    checklistState: {},
    fieldValues: normalizeCaseFieldValues(params.fieldValues, params.workflowSnapshot),
    decedentName: normalized.decedentName,
    dateOfBirth: params.dateOfBirth,
    dateOfDeath: params.dateOfDeath,
    timeOfDeath: params.timeOfDeath,
    placeOfDeath: normalized.placeOfDeath,
    weight: params.weight,
    nextOfKinName: normalized.nextOfKinName,
    nextOfKinPhone: params.nextOfKinPhone,
    nextOfKinEmail: params.nextOfKinEmail ?? null,
    nextOfKinRelationship: params.nextOfKinRelationship ?? null,
    nextOfKinRelationshipOther: normalized.nextOfKinRelationshipOther,
    tagNumber: null,
    paymentStatus: 'awaiting_payment',
    pickupStatus: 'awaiting_pickup',
    pickupReleasedTo: null,
    pickupReleasedAt: null,
    pickupNote: null,
    returnMethod: params.returnMethod ?? DEFAULT_RETURN_METHOD,
    shippingCarrier: null,
    shippingTrackingNumber: null,
    shippingDateShipped: null,
    shippingDeliveryStatus: null,
    shippingDeliveredAt: null,
    isVeteran: false,
    vaStepsState: {},
    vaPublishChoice: null,
    daysWaitingInStage: 0,
    isStalled: false,
    stalledReason: null,
    createdBy: params.createdBy,
    isArchived: false,
    createdAt: params.createdAt,
  };
}

/**
 * Runtime allowlist + type validation for a case update request body.
 * Mirrors types/case.ts's `CaseUpdate` exactly — anything not in this list
 * (organizationId, beaconCaseId/id, workflowTemplateId/Version,
 * workflowSnapshot, intakeOwnerId, createdBy, createdAt, or any unknown
 * key) is silently ignored, never applied, regardless of what a caller
 * puts in the JSON body. This is the runtime backstop CaseUpdate's type
 * only enforces at compile time — a raw HTTP JSON body has no compile-time
 * protection. "Do not allow arbitrary object spreading into Wix updates."
 *
 * Returns `errors` (present-but-wrong-typed fields) rather than silently
 * dropping them — app/api/cases/[caseId]/route.ts rejects the whole
 * request with 400 if `errors` is non-empty, rather than partially
 * applying a payload that didn't validate.
 */
export function validateAndPickCaseUpdate(body: unknown): { patch: CaseUpdate; errors: string[] } {
  const patch: CaseUpdate = {};
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return { patch, errors: ['body must be an object'] };
  }
  const b = body as Record<string, unknown>;

  function stringField(key: keyof CaseUpdate) {
    if (key in b) {
      if (typeof b[key] === 'string') (patch as Record<string, unknown>)[key] = b[key];
      else errors.push(String(key));
    }
  }
  function nullableStringField(key: keyof CaseUpdate) {
    if (key in b) {
      if (b[key] === null || typeof b[key] === 'string') (patch as Record<string, unknown>)[key] = b[key];
      else errors.push(String(key));
    }
  }
  /** Same as nullableStringField, but additionally rejects a non-null value
      that isn't a reasonably-formatted email — "validate before saving,"
      reusing the exact same validator every other email field uses. Trims
      first so surrounding whitespace never fails validation or gets
      persisted. An empty string after trimming is treated as null — this
      is an optional field, never a required "must be non-empty" one. */
  function nullableEmailField(key: keyof CaseUpdate) {
    if (key in b) {
      const raw = b[key];
      if (raw === null) {
        (patch as Record<string, unknown>)[key] = null;
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed === '') {
          (patch as Record<string, unknown>)[key] = null;
        } else if (isValidEmail(trimmed)) {
          (patch as Record<string, unknown>)[key] = trimmed;
        } else {
          errors.push(String(key));
        }
      } else {
        errors.push(String(key));
      }
    }
  }
  function booleanField(key: keyof CaseUpdate) {
    if (key in b) {
      if (typeof b[key] === 'boolean') (patch as Record<string, unknown>)[key] = b[key];
      else errors.push(String(key));
    }
  }
  function numberField(key: keyof CaseUpdate) {
    if (key in b) {
      if (typeof b[key] === 'number') (patch as Record<string, unknown>)[key] = b[key];
      else errors.push(String(key));
    }
  }
  function plainObjectField(key: keyof CaseUpdate) {
    if (key in b) {
      if (isPlainObject(b[key])) (patch as Record<string, unknown>)[key] = b[key];
      else errors.push(String(key));
    }
  }

  stringField('decedentName');
  stringField('dateOfBirth');
  stringField('dateOfDeath');
  stringField('timeOfDeath');
  stringField('placeOfDeath');
  stringField('weight');
  stringField('nextOfKinName');
  stringField('nextOfKinPhone');
  nullableEmailField('nextOfKinEmail');
  nullableStringField('nextOfKinRelationshipOther');
  nullableStringField('tagNumber');
  nullableStringField('pickupReleasedTo');
  nullableStringField('pickupReleasedAt');
  nullableStringField('pickupNote');
  nullableStringField('shippingCarrier');
  nullableStringField('shippingTrackingNumber');
  nullableStringField('shippingDateShipped');
  nullableStringField('shippingDeliveredAt');
  numberField('rawStage');
  numberField('daysWaitingInStage');
  booleanField('isVeteran');
  booleanField('isStalled');
  booleanField('isDeleted');
  nullableStringField('assignedStaffId');
  nullableStringField('stalledReason');
  plainObjectField('checklistState');
  plainObjectField('fieldValues');
  plainObjectField('vaStepsState');

  if ('pickupStatus' in b) {
    if (b.pickupStatus === 'awaiting_pickup' || b.pickupStatus === 'released') {
      patch.pickupStatus = b.pickupStatus;
    } else {
      errors.push('pickupStatus');
    }
  }
  if ('returnMethod' in b) {
    if (isValidReturnMethod(b.returnMethod)) {
      patch.returnMethod = b.returnMethod;
    } else {
      errors.push('returnMethod');
    }
  }
  if ('shippingDeliveryStatus' in b) {
    if (b.shippingDeliveryStatus === null || isValidShippingDeliveryStatus(b.shippingDeliveryStatus)) {
      patch.shippingDeliveryStatus = b.shippingDeliveryStatus as ShippingDeliveryStatus | null;
    } else {
      errors.push('shippingDeliveryStatus');
    }
  }
  if ('nextOfKinRelationship' in b) {
    if (b.nextOfKinRelationship === null || isValidNextOfKinRelationship(b.nextOfKinRelationship)) {
      patch.nextOfKinRelationship = b.nextOfKinRelationship as NextOfKinRelationship | null;
    } else {
      errors.push('nextOfKinRelationship');
    }
  }
  if ('paymentStatus' in b) {
    if (b.paymentStatus === 'awaiting_payment' || b.paymentStatus === 'paid_in_full') {
      patch.paymentStatus = b.paymentStatus;
    } else {
      errors.push('paymentStatus');
    }
  }
  if ('vaPublishChoice' in b) {
    if (b.vaPublishChoice === null || b.vaPublishChoice === 'publish' || b.vaPublishChoice === 'private') {
      patch.vaPublishChoice = b.vaPublishChoice;
    } else {
      errors.push('vaPublishChoice');
    }
  }

  // SOLIS-wide ALL-CAPS data standard (2026-09): normalized here, after
  // validation/allowlisting and before the patch is ever returned to a
  // caller — this is the one PATCH /api/cases/[caseId] chokepoint every
  // case-update path (Case Detail edits, pickup/return/shipping updates,
  // and Jotform reconciliation's "Apply" route, which sends its patch
  // through this exact route) already funnels through, so none of them
  // need their own normalization logic. `fieldValues` is intentionally
  // NOT normalized here — its per-key uppercase-ness depends on the
  // case's own workflowSnapshot, which this function has no access to;
  // see applyCaseUpdateToWixData below, which does.
  return { patch: normalizeCaseTextFields(patch), errors };
}

/**
 * Applies a validated CaseUpdate patch onto an existing `cases` Wix item's
 * raw data, renaming Beacon field names to their Wix collection
 * equivalents (assignedStaffId->caseHandlerId, rawStage->currentStage,
 * isDeleted->isArchived — the same three renames mapWixCaseItem already
 * documents, applied in reverse). Returns a *complete* object suitable for
 * updateWixDataItem's full-replace semantics — every field from `existing`
 * is preserved except the ones the patch explicitly changes.
 */
export function applyCaseUpdateToWixData(existing: WixCaseItem, patch: CaseUpdate): WixCaseItem {
  const next: WixCaseItem = { ...existing };

  if (patch.decedentName !== undefined) next.decedentName = patch.decedentName;
  if (patch.dateOfBirth !== undefined) next.dateOfBirth = patch.dateOfBirth;
  if (patch.dateOfDeath !== undefined) next.dateOfDeath = patch.dateOfDeath;
  if (patch.timeOfDeath !== undefined) next.timeOfDeath = patch.timeOfDeath;
  if (patch.placeOfDeath !== undefined) next.placeOfDeath = patch.placeOfDeath;
  if (patch.weight !== undefined) next.weight = patch.weight;
  if (patch.nextOfKinName !== undefined) next.nextOfKinName = patch.nextOfKinName;
  if (patch.nextOfKinPhone !== undefined) next.nextOfKinPhone = patch.nextOfKinPhone;
  if (patch.nextOfKinEmail !== undefined) next.nextOfKinEmail = patch.nextOfKinEmail;
  if (patch.nextOfKinRelationship !== undefined) next.nextOfKinRelationship = patch.nextOfKinRelationship;
  if (patch.nextOfKinRelationshipOther !== undefined) next.nextOfKinRelationshipOther = patch.nextOfKinRelationshipOther;
  if (patch.tagNumber !== undefined) next.tagNumber = patch.tagNumber;
  if (patch.pickupStatus !== undefined) next.pickupStatus = patch.pickupStatus;
  if (patch.pickupReleasedTo !== undefined) next.pickupReleasedTo = patch.pickupReleasedTo;
  if (patch.pickupReleasedAt !== undefined) next.pickupReleasedAt = patch.pickupReleasedAt;
  if (patch.pickupNote !== undefined) next.pickupNote = patch.pickupNote;
  if (patch.returnMethod !== undefined) next.returnMethod = patch.returnMethod;
  if (patch.shippingCarrier !== undefined) next.shippingCarrier = patch.shippingCarrier;
  if (patch.shippingTrackingNumber !== undefined) next.shippingTrackingNumber = patch.shippingTrackingNumber;
  if (patch.shippingDateShipped !== undefined) next.shippingDateShipped = patch.shippingDateShipped;
  if (patch.shippingDeliveryStatus !== undefined) next.shippingDeliveryStatus = patch.shippingDeliveryStatus;
  if (patch.shippingDeliveredAt !== undefined) next.shippingDeliveredAt = patch.shippingDeliveredAt;
  if (patch.rawStage !== undefined) next.currentStage = patch.rawStage;
  if (patch.assignedStaffId !== undefined) next.caseHandlerId = patch.assignedStaffId;
  if (patch.paymentStatus !== undefined) next.paymentStatus = patch.paymentStatus;
  if (patch.isVeteran !== undefined) next.isVeteran = patch.isVeteran;
  if (patch.vaStepsState !== undefined) next.vaStepsState = patch.vaStepsState;
  if (patch.vaPublishChoice !== undefined) next.vaPublishChoice = patch.vaPublishChoice;
  if (patch.checklistState !== undefined) next.checklistState = patch.checklistState;
  if (patch.fieldValues !== undefined) {
    // SOLIS-wide ALL-CAPS data standard (2026-09): fieldValues' per-key
    // uppercase-ness is data-driven (workflowSnapshot.intake[].uppercase),
    // never a fixed field-name allowlist — this is the one place a valid,
    // already-persisted workflowSnapshot is actually available for an
    // update patch (buildWixCaseData handles the creation-time case
    // directly, where the snapshot is a required constructor param).
    const snapshot = isValidWorkflowSnapshot(existing.workflowSnapshot) ? existing.workflowSnapshot : null;
    next.fieldValues = normalizeCaseFieldValues(patch.fieldValues, snapshot);
  }
  if (patch.daysWaitingInStage !== undefined) next.daysWaitingInStage = patch.daysWaitingInStage;
  if (patch.isStalled !== undefined) next.isStalled = patch.isStalled;
  if (patch.stalledReason !== undefined) next.stalledReason = patch.stalledReason;
  if (patch.isDeleted !== undefined) next.isArchived = patch.isDeleted;

  return next;
}
