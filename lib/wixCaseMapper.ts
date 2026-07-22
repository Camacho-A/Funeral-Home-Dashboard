import type { Case, PaymentStatus, VaPublishChoice } from '../types/case';
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
