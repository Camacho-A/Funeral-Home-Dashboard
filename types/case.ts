/**
 * Raw, persisted case record. Diverges from docs/CMS_SCHEMA.md's `Cases`
 * collection field list in a few places, each because the actual working
 * prototype (design/Beacon.dc.html) doesn't back the richer shape
 * CMS_SCHEMA.md speculated — and per this project's build-only-what's-used
 * discipline (see docs/UI_COMPONENTS.md's build-now/deferred table), the
 * simpler shape wins until a real screen needs the richer one:
 *
 * - `decedentName` is a single field, not `decedentFirstName`/`decedentLastName`
 *   — the prototype only ever stores/displays a full name string
 *   ("Robert Ellison"), never split, and splitting it would require
 *   guessing at multi-word name boundaries with no real payoff.
 * - `rawStage` is the numeric 0-8 index the domain logic actually operates
 *   on (see domain/cases/stages.ts), not a `status` enum string —
 *   matching how design/support.js's Component script represents it.
 * - No `dispositionType` field — it never appears anywhere in
 *   design/support.js's seed data or UI, unlike what CMS_SCHEMA.md proposed.
 * - No standalone `notes` field — the prototype's only free-text record on
 *   a case is the structured case log (a distinct, deferred entity; see
 *   types/caseLogEntry.ts), not a single notes blob.
 * - `checklistState`/`fieldValues`/`isVeteran`/`vaStepsState`/`vaPublishChoice`
 *   are what CMS_SCHEMA.md already called for — these are real persisted
 *   business data (once a checklist item is checked, that's a fact, not
 *   transient UI state), not something layered on top separately.
 */
import type { CaseWorkflowSnapshot } from './workflowTemplate';

export type PaymentStatus = 'awaiting_payment' | 'paid_in_full';
export type VaPublishChoice = 'publish' | 'private';

export type Case = {
  id: string;
  organizationId: string;
  decedentName: string;
  dateOfBirth: string; // display-formatted (MM/DD/YYYY), matching the prototype — no date math is ever performed on it directly
  dateOfDeath: string;
  timeOfDeath: string;
  placeOfDeath: string;
  weight: string; // e.g. "178 lb" — parsed at derivation time for the >200lb flag, see domain/cases/viewModel.ts
  rawStage: number; // 0-8; see domain/cases/stages.ts for the raw->display mapping
  /** references StaffProfile.id; null = unassigned ("—" in the prototype).
      The *current* case handler — freely reassignable any time via
      CaseInformationCard's owner select (see useCaseMutations.reassignOwner).
      Distinct from intakeOwnerId below, which never changes after creation
      even though the two happen to start out equal. */
  assignedStaffId: string | null;
  nextOfKinName: string;
  nextOfKinPhone: string;
  paymentStatus: PaymentStatus;
  isVeteran: boolean;
  vaStepsState: Record<number, boolean>;
  vaPublishChoice: VaPublishChoice | null;
  checklistState: Record<number, boolean>;
  fieldValues: Record<number, string>;
  daysWaitingInStage: number; // mock-static for this phase; a real backend would derive this from a stage-entry timestamp
  isStalled: boolean;
  stalledReason: string | null;
  createdBy: string | null; // references StaffProfile.id, per docs/CMS_SCHEMA.md's "staff member who opened the case" — same FK convention as assignedStaffId, not a free-text name
  /** The staff member who took the intake call, derived automatically from
      the trusted session at creation time (see casesService.create) — never
      accepted from the New Case form and never editable afterward, unlike
      assignedStaffId. Enforced at three layers: NewCaseInput has no such
      field (so the form literally cannot supply one), CaseUpdate omits it
      below (a compile-time guarantee), and
      domain/cases/intakeOwnership.ts's assertIntakeOwnerUnchanged is a
      runtime backstop against anything that reaches the service anyway
      (an `as any` cast, or a future non-TS caller). Null only for
      historical/seed records that predate this field — a real gap, not a
      fabricated backfill. */
  intakeOwnerId: string | null;
  createdAt: string;
  isDeleted: boolean; // soft-delete only, per docs/DECISIONS.md and docs/adr — never hard-deleted

  /**
   * Phase 11 (Workflow Template Architecture). Which workflow template —
   * and, critically, which *version* of it — this case was created from.
   * See types/workflowTemplate.ts and docs/TEMPLATE_VERSIONING.md.
   */
  workflowTemplateId: string;
  workflowTemplateVersion: number;
  /** Which of the template's supported case types this specific case is —
      a template can support more than one (e.g. cremation + burial), so
      the case itself has to record which one applies to it. */
  caseType: string;
  /** Immutable copy of the resolved stages/checklist/intake structure at
      creation time — see types/workflowTemplate.ts's CaseWorkflowSnapshot
      comment. Every stage/checklist-resolving domain function
      (domain/workflow/*, domain/cases/viewModel.ts) reads this, never the
      live WorkflowTemplate fixture, so editing a template later can never
      retroactively change an existing case. Null only for historical/seed
      records migrated before this field existed — see
      docs/TEMPLATE_VERSIONING.md's migration notes; every backfilled
      fixture case is given the Managed Cremations v1 snapshot, so in
      practice this is non-null for all current mock data. */
  workflowSnapshot: CaseWorkflowSnapshot | null;
};

/**
 * Deliberately excludes `createdBy`, `intakeOwnerId`, `assignedStaffId`,
 * and the Phase 11 workflow fields (`workflowTemplateId`,
 * `workflowTemplateVersion`, `caseType`, `workflowSnapshot`) from the
 * required fields a caller must supply — all of these are derived by
 * casesService.create from trusted parameters (session, the resolved
 * WorkflowTemplate/version — see its own signature), never from
 * client-editable form state. `assignedStaffId` stays available as an
 * *optional* override for a future caller with an explicit assignee
 * picker; the New Case modal doesn't pass one, so it falls back to the
 * session default, matching design/support.js's `owner: createdBy`
 * behavior.
 */
export type NewCaseInput = Pick<Case, 'decedentName' | 'nextOfKinName' | 'nextOfKinPhone'> &
  Partial<
    Pick<
      Case,
      'dateOfBirth' | 'dateOfDeath' | 'timeOfDeath' | 'placeOfDeath' | 'weight' | 'assignedStaffId'
    >
  > & {
    fieldValues?: Record<number, string>;
  };

/**
 * `createdBy`, `intakeOwnerId`, `workflowTemplateId`, and
 * `workflowTemplateVersion` are excluded here, not just left off
 * NewCaseInput — this is the compile-time half of their immutability
 * guarantee; domain/cases/intakeOwnership.ts's assertIntakeOwnerUnchanged
 * is the runtime half for intakeOwnerId (the only one of these with an
 * explicit "Rules" requirement to enforce at runtime too).
 * `workflowSnapshot` is likewise excluded — it's a point-in-time copy, not
 * something an update patch should ever touch.
 */
export type CaseUpdate = Partial<
  Omit<
    Case,
    | 'id'
    | 'organizationId'
    | 'createdAt'
    | 'createdBy'
    | 'intakeOwnerId'
    | 'workflowTemplateId'
    | 'workflowTemplateVersion'
    | 'workflowSnapshot'
  >
>;
