/**
 * Phase 11 (Workflow Template Architecture). These types move organization-
 * specific case behavior — intake fields, stages, checklist items, JotForm
 * references — out of hardcoded domain constants (domain/cases/stages.ts,
 * checklist.ts) and React components (NewCaseModal's old FIELD_GROUPS) into
 * versioned, per-organization configuration. Managed Cremations gets a
 * template that reproduces its pre-Phase-11 behavior exactly (see
 * services/__mocks__/workflowTemplates.ts, built *from* the original
 * constants so the two can't drift) — see docs/TEMPLATE_VERSIONING.md for
 * the full model and docs/adr/ADR-006-workflow-template-architecture.md for
 * why this shape was chosen.
 *
 * Terminology carried over unchanged from earlier phases: `organizationId`
 * (never "tenantId"), `intakeOwnerId` (immutable, set from the trusted
 * session — see domain/cases/intakeOwnership.ts) and `assignedStaffId`
 * (a.k.a. "case handler" — freely reassignable). Neither of those changes
 * here; templates only affect stages/checklist/intake structure.
 */

export type ChecklistItemTemplate = {
  /** Position within the stage's checklist — matches the legacy
      checklistState/fieldValues indexing on Case, so existing per-item
      done/locked/field-value storage keeps working unchanged. */
  index: number;
  label: string;
  /** Data-entry item (done once it has a non-empty value) vs a plain
      toggle checkbox — the same concept as the old isFirstCallStage-derived
      hasField, now a per-item template property instead of a rawStage
      special case. */
  hasField: boolean;
  isPasswordField?: boolean;
  /** Set when this item is fulfilled via an external form instead of a
      plain checkbox/field (JotForm today) — see
      types/externalFormIntegration.ts. Metadata only; done/locked
      resolution (domain/workflow/resolveChecklist.ts) never branches on
      this or on any provider name. */
  externalFormIntegrationId?: string | null;
  /** Structured Certifier data (2026-09, ADR-041). When present, this
      item's completion is computed directly from these Case fields (every
      listed field must be a non-empty string) instead of from
      fieldValues/checklistState — the generic mechanism behind the
      "Certifier Information" item, not hardcoded to that one item. An item
      with this set should also set hasField: false (no inline checklist
      textbox — the real edit surface is Case Information) and is rendered
      isDerived: true (checkbox toggle disabled), mirroring the existing
      terminal return-of-remains item's own isDerived precedent
      (domain/cases/viewModel.ts). */
  requiredCaseFields?: string[];
  /** Declarative rendering hint for a field-backed item (hasField: true)
      whose canonical value is a 24-hour HH:mm string but should be edited/
      displayed as 12-hour AM/PM (e.g. Time of Death) — lets
      ChecklistCard.tsx pick the right editor from template metadata
      instead of string-matching the item's label. */
  valueKind?: 'time';
  /** Shared workflow foundation (2026-11). A stable, organization-neutral
      identifier for the business requirement this item represents (e.g.
      'cremation.crematory.permit_sent'). Optional and additive: storage
      keys stay "{displayStage}:{index}" (domain/workflow/checklistItemKey.ts);
      a stepId only lets shared logic FIND an item without depending on its
      position or wording. Templates and snapshots written before 2026-11
      (every existing Manors case) have none, and callers fall back to the
      position-and-label checks they always used. */
  stepId?: string;
};

export type ChecklistTemplate = {
  items: ChecklistItemTemplate[];
};

export type StageTemplate = {
  /** Internal progress counter — Case.rawStage. Two StageTemplate entries
      can share a displayStage (Managed Cremations' First Call and Payment
      both display as one combined stepper dot) — see
      docs/TEMPLATE_VERSIONING.md's "raw vs. display stage" section. */
  rawStage: number;
  /** Which stepper position this stage renders at (0-based). */
  displayStage: number;
  label: string;
  /** Replaces the old hardcoded isBottleneckStage() string-match against a
      specific label — which stage(s) should render with the "needs
      attention" badge color is now data, not a match against literal
      text. */
  isAttentionStage?: boolean;
  slaTargetDays: number | null;
  checklist: ChecklistTemplate;
  /** Shared workflow foundation (2026-11): the stage's stable identifier,
      e.g. 'cremation.crematory'. Optional — see ChecklistItemTemplate.stepId. */
  stageKey?: string;
};

/**
 * Phase 19 (Configurable Intake Form Builder). The field types an admin can
 * choose from in the Workflow Editor's intake builder — see
 * domain/workflow/resolveIntakeField.ts for the fieldType -> rendering/
 * masking/validation defaults NewCaseModal.tsx resolves each field through.
 *
 * Phase 19A (Secure Payment Architecture) removed 'creditCard' | 'expiration'
 * | 'cvv' — Phase 19 originally modeled a payment section as three separate,
 * ordinary intake fields sharing one checklistItemIndex, which meant
 * domain/workflow/resolveIntake.ts's buildIntakeFieldValues concatenated the
 * PAN, expiration, and CVV into one plaintext string and persisted it in
 * Case.fieldValues — in Wix, permanently, unencrypted. 'payment' replaces
 * all three: one field represents an entire secure payment *section*, never
 * an ordinary data-entry field — see docs/adr/ADR-021-secure-payment-architecture.md.
 * This is a breaking removal, not a deprecation: the live Wix template
 * predating this phase never had `fieldType` set on its card fields at all
 * (confirmed empirically, not assumed — see the ADR), so no stored data
 * anywhere references the removed type strings.
 */
export type IntakeFieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'time'
  | 'phone'
  | 'email'
  | 'number'
  | 'currency'
  | 'checkbox'
  | 'select'
  | 'payment';

/**
 * Which shared utils/inputMask.ts validator (if any) NewCaseModal runs
 * against this field's value — 'none' is a real, explicit choice (some
 * fields, like a hospice contact's name, have nothing to validate against),
 * not the same as "unset."
 *
 * Phase 19A (Secure Payment Architecture) removed 'creditCard' | 'expiration'
 * — not just the matching fieldTypes above. Leaving either as a selectable
 * validationType would have left a back door open: an admin (or a forged
 * request) could set fieldType: 'text' with validationType: 'creditCard' on
 * a checklistItemIndex-linked field and reconstruct the exact vulnerability
 * this phase closes, just via a different field-type combination. The
 * underlying validators (isValidCreditCardNumber, isValidExpiryMonth,
 * formatCardExpiryInput in utils/inputMask.ts) are unchanged and still
 * exported — only their reachability from workflow configuration is gone.
 */
export type IntakeValidationType =
  | 'none'
  | 'email'
  | 'phone'
  | 'date'
  | 'zip'
  | 'numeric'
  | 'currency'
  | 'time';

export type IntakeFieldTemplate = {
  /** Stable key used both as the New Case form's draft-state key and,
      when set, to populate a structured Case field directly (decedentName,
      nextOfKinName, ...) — see mapsToCaseField. Doubles as this field's
      "id": nothing else on an IntakeFieldTemplate ever needs a second,
      separate identifier. */
  key: string;
  label: string;
  placeholder?: string;
  /** Legacy name for "renders masked with a Show/Hide toggle," predating
      Phase 19's `masked` (see below) — still honored on its own so every
      pre-Phase-19 record (the mock fixture, and the real Wix template
      created before this phase) keeps masking exactly the fields it
      always did, with no data migration. New/edited fields should set
      `masked` instead; domain/workflow/resolveIntakeField.ts is the one
      place that reads both and picks whichever is set. */
  password?: boolean;
  /** Which checklist item (by index, within the stage this intake feeds)
      this field's value seeds at case-creation time. Multiple fields can
      share an index — domain/workflow/resolveIntake.ts joins their values
      with " — ", matching how "Next of kin name" + "Next of kin phone"
      still combine into the checklist's single "Family contact" item. */
  checklistItemIndex?: number;
  /** When set, this intake value also populates a structured field on the
      created Case (e.g. 'decedentName', 'placeOfDeath') — distinct from
      checklistItemIndex, since a field can do either, both, or neither
      (the five card sub-fields feed the checklist only; decedentName
      feeds both). */
  mapsToCaseField?: string;

  /**
   * Phase 19 (Configurable Intake Form Builder) additions — every one of
   * these is optional so every IntakeFieldTemplate that predates this phase
   * (the mock fixture below and the real, already-created Wix
   * `workflowTemplateVersions` row) remains a fully valid value of this
   * type with no migration; domain/workflow/resolveIntakeField.ts's
   * resolveIntakeField supplies a safe default for anything left unset,
   * and is the *only* place that does — NewCaseModal.tsx and
   * components/settings/'s intake editor both call it rather than each
   * re-deriving their own defaults. See docs/adr/ADR-020-configurable-intake-form-builder.md.
   */
  fieldType?: IntakeFieldType;
  /** Blocks New Case submission while blank — generalizes what was
      previously hardcoded as "decedentName specifically is required." */
  required?: boolean;
  defaultValue?: string;
  /** Explicit position within this field's section — defaults to the
      field's own array index when absent (a pre-Phase-19 record has no
      opinion on this, so it renders in the order it's already stored in,
      unchanged). A *hint* the render order sorts by, not a strict,
      no-gaps invariant the way StageTemplate.rawStage is — see
      domain/workflow/editing.ts's validateIntakeFields for why. */
  displayOrder?: number;
  uppercase?: boolean;
  /** Preferred name for "renders masked with a Show/Hide toggle" — see
      `password` above for the legacy name it supersedes. */
  masked?: boolean;
  /** Mirrors `fieldType === 'textarea'` — kept as its own explicit
      property because Phase 19's own field schema names it, but it isn't
      independently settable in the Workflow Editor (that would allow the
      contradictory `fieldType: 'text', multiline: true`); resolveIntakeField
      always derives it from fieldType. */
  multiline?: boolean;
  validationType?: IntakeValidationType;
  /** Only meaningful for fieldType 'select' — the option labels. */
  options?: string[];

  /**
   * Phase 19A (Secure Payment Architecture). Only meaningful for
   * fieldType 'payment' — what an admin configures for a payment section
   * (what it's collecting, for how much, and any guidance text). There is
   * deliberately no field here (or anywhere on IntakeFieldTemplate) for a
   * card number, expiration, or CVV — those are never workflow
   * configuration; they're the future payment provider's own implementation
   * detail. See docs/adr/ADR-021-secure-payment-architecture.md.
   */
  paymentPurpose?: string;
  /** Informational only in this phase (no provider exists yet to actually
      charge it) — e.g. "$1,200.00". A plain string, not validated as
      currency here, since it's descriptive text shown to staff/family, not
      a value anything computes with. */
  paymentAmount?: string;
  paymentDescription?: string;
};

export type IntakeSectionTemplate = {
  key: string;
  label: string;
  fields: IntakeFieldTemplate[];
};

export type IntakeTemplate = {
  sections: IntakeSectionTemplate[];
};

export type WorkflowTemplateVersion = {
  /** Starts at 1, increments on every edit — append-only, never mutated in
      place (see docs/TEMPLATE_VERSIONING.md). A Case stores the exact
      version it was created against (Case.workflowTemplateVersion) plus a
      full immutable copy (Case.workflowSnapshot), so editing this array
      later never changes how an existing case renders. */
  version: number;
  /** Which case types this specific version supports — a version can
      narrow or widen the template's own caseTypes over time. */
  caseTypes: string[];
  stages: StageTemplate[];
  intake: IntakeTemplate;
  createdAt: string;
  /**
   * Service-specific workflows (2026-10). Whether this version may be used
   * for live cases. ABSENT MEANS APPROVED — every version that predates
   * this field (every Manors/evergreen row, mock or Wix) keeps behaving
   * exactly as before. Only an organization whose profile sets
   * `features.workflowApprovalRequired` ever creates 'draft' versions, and
   * case creation for an organization with `workflowByServiceType` only
   * ever snapshots an approved one (domain/workflow/selectWorkflowTemplate.ts).
   * See docs/GUS_WORKFLOWS.md.
   */
  status?: WorkflowTemplateVersionStatus;
  /** Who approved this version (identity id) — set only by the approve
      route, never by a version save. */
  approvedBy?: string | null;
  approvedAt?: string | null;
  /**
   * Workflow template editor (2026-10) — all optional, absent on every
   * version saved before them. Who saved this version (identity id) and
   * the display names of the saver/approver as they were at that moment
   * (shown in Settings' version history; the activity log keeps the
   * authoritative record).
   */
  createdBy?: string | null;
  createdByName?: string | null;
  approvedByName?: string | null;
  /** Service-based workflows (2026-11): the service type codes this version
      serves (e.g. ['CREMATION_WITH_VIEWING']) — the assignment it proposes;
      applied to the template (WorkflowTemplate.serviceTypeCodes) only once
      the version is approved, so a draft never re-routes case creation.
      Absent for an organization that runs one workflow for every case
      (Manors). */
  serviceTypeCodes?: string[];
  /**
   * Service-specific completion (2026-10). What "this case is finished"
   * means for cases created from this version — see
   * WorkflowCompletionPolicy and domain/workflow/completionPolicy.ts.
   * ABSENT MEANS TODAY'S RULE (the return of cremated remains, nothing
   * else), so every version that predates the field — every Manors and
   * evergreen row, and any already-approved Gus row — behaves exactly as
   * before. Copied onto the case's frozen snapshot at creation.
   */
  completionPolicy?: WorkflowCompletionPolicy;
  /**
   * Unfinished-workflow protection (2026-10). Set on a version whose
   * content started life as a copy of another template (Gus' five draft
   * services were copied from Direct Cremation). Carried forward by every
   * later save, never accepted from a client. Approval refuses a version
   * whose stages and completion requirements are still identical to any
   * version of that source — see
   * domain/workflow/completionPolicy.ts#isUnmodifiedCopy. Absent = not a
   * copy (no check).
   */
  derivedFrom?: WorkflowVersionSource | null;
  /** Shared workflow foundation (2026-11): which shared base workflow and
      which service extensions this version was composed from — recorded so
      a case can always say what its process was built on. */
  composition?: WorkflowComposition;
};

/** Which template version another version was copied from. */
export type WorkflowVersionSource = {
  templateId: string;
  version: number;
};

/**
 * A checklist item the completion policy requires, addressed the same way
 * stored completion is ("{displayStage}:{index}") plus the item's label at
 * the time it was chosen — so a later edit that moves or renames the item
 * is detected (domain/workflow/completionPolicy.ts) instead of silently
 * pointing the requirement at a different item.
 */
export type CompletionItemRef = {
  displayStage: number;
  index: number;
  label: string;
};

/**
 * - 'remains_return' — finished once the return of cremated remains to
 *   the family is recorded (pickup released / shipment delivered), plus
 *   any required final items. Today's cremation rule.
 * - 'final_items' — finished once every required final item is done; no
 *   remains are returned (burial, entombment).
 */
export type WorkflowCompletionKind = 'remains_return' | 'final_items';

/** Existing permissions that may gate a staff "Mark completed" action —
    never a new permission (domain/rbac/permissionCatalog.ts). */
export type ManualCompletionPermission = 'case.update' | 'case.delete';

/**
 * Service-specific completion (2026-10). Configured per workflow template
 * VERSION in Settings › Workflow Templates and frozen onto each case's
 * snapshot, so the completion rule a case is judged by never changes
 * under it. Evaluated by domain/cases/completionEligibility.ts.
 */
export type WorkflowCompletionPolicy = {
  kind: WorkflowCompletionKind;
  /** Must agree with `kind` ('remains_return' ⇔ true) — kept explicit so
      a reader of the stored JSON never has to know the mapping. */
  requiresRemainsReturn: boolean;
  /** Items in the final stage or the stage before it that must be done.
      Empty for a 'final_items' policy means "not defined yet": such a
      case can never complete and the version cannot be approved. */
  requiredFinalItems: CompletionItemRef[];
  /** A permission-gated, audited staff action that completes a case on
      its final stage when the required final items cannot all be
      recorded. Never stands in for the return of cremated remains. */
  manualCompletion: { allowed: boolean; permission?: ManualCompletionPermission };
  /** 'on_completion' (today's behaviour): the case archives itself the
      moment it completes. 'manual': a completed case stays in the working
      lists until staff archive it. */
  archiveEligibility: 'on_completion' | 'manual';
  /** Administrator-facing note (e.g. "service-specific completion
      requirements to be defined"). Never read by case logic. */
  note?: string | null;
};

/** The shared base (e.g. the cremation foundation) plus the service
    extensions layered on it, each at the version used. */
export type WorkflowComposition = {
  base: { key: string; version: number };
  extensions: Array<{ key: string; version: number }>;
};

export type WorkflowTemplateVersionStatus = 'draft' | 'approved';

/** Unfinished-workflow protection (2026-10). What an approver affirms they
    reviewed before approving a version — each must be exactly `true`
    (app/api/workflow-templates/[templateId]/versions/[version]/approve). */
export type WorkflowApprovalAttestation = {
  stagesReviewed: boolean;
  checklistReviewed: boolean;
  completionReviewed: boolean;
};

export type WorkflowTemplate = {
  id: string;
  organizationId: string;
  name: string;
  /** An org can have more than one template (e.g. different case types);
      only enabled ones are offered when creating a case. */
  isEnabled: boolean;
  /** Case types this template supports across all its versions — e.g.
      ['cremation']. A template with multiple case types lets one workflow
      serve more than one kind of case; see the "Required behavior" note in
      docs/TEMPLATE_VERSIONING.md. */
  caseTypes: string[];
  /** Append-only; the latest version is versions[versions.length - 1]. */
  versions: WorkflowTemplateVersion[];
  /**
   * Service-specific workflows (2026-10). The `service_type` catalog codes
   * (ServiceSelections.serviceTypeCode) this template is THE workflow for.
   * Only read for an organization whose profile sets
   * `features.workflowByServiceType`; absent/empty everywhere else, where
   * "first enabled template" stays the rule.
   */
  serviceTypeCodes?: string[];
  /** Free-text administrator note shown in Settings › Workflow Templates
      (e.g. why a template is still a draft). Never read by case logic. */
  description?: string | null;
};

/**
 * The immutable, point-in-time copy embedded on every Case at creation
 * (Case.workflowSnapshot) — everything domain/workflow/'s resolution
 * functions need to render a case's stages/checklist/intake without
 * re-reading the (possibly since-edited) live WorkflowTemplate. This is
 * the actual immutability guarantee the phase asked for: editing
 * services/__mocks__/workflowTemplates.ts after a case exists can never
 * retroactively change that case, because the case never reads the live
 * template again.
 */
export type CaseWorkflowSnapshot = {
  workflowTemplateId: string;
  workflowTemplateVersion: number;
  stages: StageTemplate[];
  intake: IntakeTemplate;
  /** Service-specific workflows (2026-10). The service type this case's
      workflow was selected for. Absent on every snapshot taken before
      this field existed and for organizations without
      `workflowByServiceType` — never inferred. */
  serviceTypeCode?: string | null;
  /** Copied from the template version (2026-11); absent before. */
  composition?: WorkflowComposition;
  /** Service-specific completion (2026-10). The version's completion
      policy, copied only when the version has one — absent on every
      older snapshot, which keeps today's rule (see
      WorkflowTemplateVersion.completionPolicy). */
  completionPolicy?: WorkflowCompletionPolicy;
};
