/**
 * The derived, display-ready shape produced by domain/cases/viewModel.ts —
 * the direct analog of the original design/support.js script's buildCase().
 *
 * Deliberately pure data: no onClick handlers, no color hex codes, no
 * component-specific booleans like "cursor: pointer". The original script
 * baked event-handler closures directly into this object because its
 * template-binding runtime needed that; here, badge/severity is expressed as
 * a semantic variant (e.g. 'danger'), and *components* (Phase 5+) decide how
 * to render that variant and *hooks* (useCaseMutations, Phase 6) decide what
 * happens on click. This keeps domain/ free of React and presentation
 * concerns, per docs/adr/ADR-004-domain-layer.md.
 */
import type { PaymentStatus, VaPublishChoice } from './case';

export type BadgeVariant = 'neutral' | 'brand' | 'danger' | 'success';

export type ChecklistItemViewModel = {
  index: number;
  label: string;
  done: boolean;
  locked: boolean;
  /** First Call & Payment items are data-entry fields, not plain checkboxes. */
  hasField: boolean;
  fieldValue: string;
  fieldIsPassword: boolean;
};

export type VaStepViewModel = {
  index: number;
  label: string;
  done: boolean;
  locked: boolean;
};

export type TimelineEntryViewModel = {
  who: string;
  what: string;
  /** Ordinal position, newest first — real relative-time formatting
      ("Today", "2 days ago") is a presentation concern for Phase 6, not
      computed here. */
  daysAgo: number;
};

export type RequiredDocumentViewModel = {
  label: string;
  status: 'pending' | 'signed' | 'filed';
};

export type CaseViewModel = {
  id: string;
  /** Phase 16B (Case Number Generation) — the human-facing identifier
      (`B{YYYY}-{###}`), always server-generated and read-only. See
      types/case.ts's own field comment and
      docs/adr/ADR-018-case-number-generation.md. */
  caseNumber: string;
  decedentName: string;
  dateOfBirth: string;
  dateOfDeath: string;
  timeOfDeath: string;
  placeOfDeath: string;

  displayStage: number; // 0-6
  stageLabel: string;
  stageBadgeVariant: BadgeVariant; // 'danger' only for the known-bottleneck stage, 'neutral' otherwise — see domain/cases/stages.ts

  ownerStaffId: string | null;
  ownerName: string; // resolved display name, or "—" if unassigned
  ownerInitials: string;
  /** ownerName, falling back to "Office" when unassigned — used for
      attribution (activity timeline, case log author) where "—" wouldn't
      make sense as an actor name. */
  effectiveOwnerName: string;

  weight: string;
  weightOver200: boolean;

  daysWaitingInStage: number;
  slaTargetDays: number | null;
  slaTargetLabel: string;
  isOverdue: boolean;

  isStalled: boolean;
  stalledReason: string | null;
  needsAttention: boolean;
  attentionReason: string;

  /** The label of the first not-yet-done checklist item ("Review case" if
      none) — the prototype's own `nextAction` concept (buildCase()), i.e.
      "what should happen next on this case." */
  nextActionLabel: string;
  /** stalledReason when stalled, else nextActionLabel — computed once here
      rather than in every row component that displays it (Dashboard's
      AllCasesList and StageFilteredPanel both need this exact fallback). */
  rowSummaryText: string;
  rowSummaryVariant: Extract<BadgeVariant, 'danger' | 'neutral'>;

  paymentStatus: PaymentStatus;
  paymentStatusVariant: BadgeVariant;

  isVeteran: boolean;
  veteranFlagLocked: boolean; // locked once the case is past First Call & Payment
  vaSteps: VaStepViewModel[];
  vaAllStepsDone: boolean;
  /** Step index 1 ("VA called back with a date") is done — gates whether the
      publish/private choice appears. Named rather than left for callers to
      re-derive from vaSteps[1], since "which step index this is" is domain
      knowledge (see domain/cases/veteran.ts's isVaCallbackDone). */
  vaCallbackDone: boolean;
  vaPublishChoice: VaPublishChoice | null;
  vaComplete: boolean; // all steps done AND a publish choice made

  /** The checklist for the case's *current* stage, unless a past stage is
      being viewed read-only (see viewingDisplayStage in
      domain/cases/viewModel.ts's context param). */
  checklist: ChecklistItemViewModel[];
  viewingDisplayStage: number | null; // non-null only when viewing a past stage read-only

  timeline: TimelineEntryViewModel[];
  requiredDocuments: RequiredDocumentViewModel[];

  /** Phase 11 (Workflow Template Architecture): ordered display-stage
      labels from this case's own workflowSnapshot, one per stepper
      position — lets the Case Detail page build its stepper and
      viewing-stage-label from real per-case template data instead of a
      hardcoded stage-list import, so a case belonging to a different
      workflow template renders its own stages correctly through the same
      shared StageStepper component. */
  stageLabels: string[];
};
