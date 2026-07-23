import type { Case, CaseUpdate, PaymentStatus, VaPublishChoice } from '../types/case';
import type { CaseWorkflowSnapshot } from '../types/workflowTemplate';

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
  paymentStatus?: unknown;
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
    paymentStatus: item.paymentStatus as PaymentStatus,
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
  fieldValues: Record<number, string>;
  createdAt: string;
}): WixCaseItem {
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
    fieldValues: params.fieldValues,
    decedentName: params.decedentName,
    dateOfBirth: params.dateOfBirth,
    dateOfDeath: params.dateOfDeath,
    timeOfDeath: params.timeOfDeath,
    placeOfDeath: params.placeOfDeath,
    weight: params.weight,
    nextOfKinName: params.nextOfKinName,
    nextOfKinPhone: params.nextOfKinPhone,
    paymentStatus: 'awaiting_payment',
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

  return { patch, errors };
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
  if (patch.rawStage !== undefined) next.currentStage = patch.rawStage;
  if (patch.assignedStaffId !== undefined) next.caseHandlerId = patch.assignedStaffId;
  if (patch.paymentStatus !== undefined) next.paymentStatus = patch.paymentStatus;
  if (patch.isVeteran !== undefined) next.isVeteran = patch.isVeteran;
  if (patch.vaStepsState !== undefined) next.vaStepsState = patch.vaStepsState;
  if (patch.vaPublishChoice !== undefined) next.vaPublishChoice = patch.vaPublishChoice;
  if (patch.checklistState !== undefined) next.checklistState = patch.checklistState;
  if (patch.fieldValues !== undefined) next.fieldValues = patch.fieldValues;
  if (patch.daysWaitingInStage !== undefined) next.daysWaitingInStage = patch.daysWaitingInStage;
  if (patch.isStalled !== undefined) next.isStalled = patch.isStalled;
  if (patch.stalledReason !== undefined) next.stalledReason = patch.stalledReason;
  if (patch.isDeleted !== undefined) next.isArchived = patch.isDeleted;

  return next;
}
