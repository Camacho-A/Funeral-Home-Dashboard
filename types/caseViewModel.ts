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

  paymentStatus: PaymentStatus;
  paymentStatusVariant: BadgeVariant;

  isVeteran: boolean;
  veteranFlagLocked: boolean; // locked once the case is past First Call & Payment
  vaSteps: VaStepViewModel[];
  vaAllStepsDone: boolean;
  vaPublishChoice: VaPublishChoice | null;
  vaComplete: boolean; // all steps done AND a publish choice made

  /** The checklist for the case's *current* stage, unless a past stage is
      being viewed read-only (see viewingDisplayStage in
      domain/cases/viewModel.ts's context param). */
  checklist: ChecklistItemViewModel[];
  viewingDisplayStage: number | null; // non-null only when viewing a past stage read-only

  timeline: TimelineEntryViewModel[];
  requiredDocuments: RequiredDocumentViewModel[];
};
