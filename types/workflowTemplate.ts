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
};

/**
 * Phase 19 (Configurable Intake Form Builder). The field types an admin can
 * choose from in the Workflow Editor's intake builder — see
 * domain/workflow/resolveIntakeField.ts for the fieldType -> rendering/
 * masking/validation defaults NewCaseModal.tsx resolves each field through.
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
  | 'creditCard'
  | 'expiration'
  | 'cvv';

/**
 * Which shared utils/inputMask.ts validator (if any) NewCaseModal runs
 * against this field's value — 'none' is a real, explicit choice (some
 * fields, like a hospice contact's name, have nothing to validate against),
 * not the same as "unset."
 */
export type IntakeValidationType =
  | 'none'
  | 'email'
  | 'phone'
  | 'date'
  | 'zip'
  | 'numeric'
  | 'currency'
  | 'creditCard'
  | 'expiration';

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
};
