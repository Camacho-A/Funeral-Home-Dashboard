import type { Case } from '../../types/case';
import type { StaffProfile } from '../../types/staffProfile';
import type {
  CaseViewModel,
  RequiredDocumentViewModel,
  ChecklistItemViewModel,
  CaseRowSummaryVariant,
} from '../../types/caseViewModel';
import { resolveChecklist } from '../workflow/resolveChecklist';
import {
  findStageByRawStage,
  findStageByDisplayStage,
  displayStagesInOrder,
  lastDisplayStage,
  isOverdue,
} from '../workflow/resolveStages';
import { resolveEffectiveDisplayStage } from './transitions';
import { isTerminalReturnRequirementComplete, terminalReturnRequirementLabel, returnMethodStageHeading } from './returnMethod';
import { formatSlaTarget } from './sla';
import {
  buildVaSteps,
  isVaCallbackDone,
  isVaComplete,
  isVeteranFlagLocked,
  needsVeteranAttention,
  VA_STEPS,
} from './veteran';
import { buildTimeline } from './timeline';
import { applyLegacyCertifierPresentation } from './legacyCertifierPresentation';
import {
  presentedStages,
  toPresentedStageIndex,
  presentsCombinedIntakeLabelsUppercase,
} from '../organization/workflowStagePresentation';
import { findChecklistIndexForCaseField } from '../workflow/resolveIntake';
import { initialsFromName } from '../../utils/string';
import { parseLegacyTimeOfDeath } from '../../utils/inputMask';
import { normalizeNextOfKinName } from './nextOfKinName';
import { getChecklistLabels } from './checklist';
import { computeCaseProgress } from './progress';

export type CaseViewModelContext = {
  staffList: StaffProfile[];
  /** Set when the caller is viewing a past stage's checklist read-only
      (Phase 6's StageStepper). Only affects the `checklist` field — every
      other field always reflects the case's real, current state. */
  viewingDisplayStage?: number | null;
};

function resolveOwner(case_: Case, staffList: StaffProfile[]): { name: string; initials: string } {
  const staff = staffList.find((s) => s.id === case_.assignedStaffId);
  const name = staff?.displayName ?? '—';
  const initials = name === '—' ? '?' : initialsFromName(name);
  return { name, initials };
}

/**
 * Case Information legacy fieldValues compatibility fallback (2026-09).
 * Weight and Time of Death are structured Case properties that are also
 * field-backed checklist items (see hooks/useCaseMutations.ts's own
 * comment on why both must stay in sync) — the structured property is
 * always authoritative and always wins here whenever it has a real value.
 * This fallback only ever applies to a case whose structured field is
 * still blank while its checklist fieldValues mirror already carries a
 * real value — e.g. a value entered before the write-side sync fix
 * (lib/wixCaseMapper.ts#applyCaseUpdateToWixData /
 * services/casesService.ts#update) existed. Display-only: never writes
 * anything back to the Case itself, and no Production migration is
 * implied or performed by this function existing.
 *
 * "No real value yet" means either a genuinely empty string or this
 * codebase's own existing unset-placeholder convention (`'—'` —
 * services/casesService.ts#create's own default for an unset weight/
 * timeOfDeath, the same placeholder resolveOwner/effectiveOwnerName above
 * already treat as "not really a value" for the exact same reason).
 *
 * `normalizeLegacyValue` (Time of Death only, 2026-09 follow-up): a case
 * frozen under a pre-v5 workflowSnapshot has no `valueKind: 'time'` on the
 * checklist item, so its fieldValues mirror may hold whatever staff typed
 * into that free-text box (e.g. "11:30AM"), not strict "HH:mm" — passing
 * that straight through would just get silently blanked by
 * CaseInformationCard's canonical-format display formatter, the exact
 * failure this fallback exists to fix. When a normalizer is supplied, an
 * unparseable legacy value falls back to `structured` (the placeholder)
 * rather than guessing. Weight has no such normalizer — its display never
 * re-parses the value, so the raw fieldValues passthrough is unaffected.
 */
function resolveFieldWithLegacyFallback(
  case_: Case,
  field: 'weight' | 'timeOfDeath',
  normalizeLegacyValue?: (value: string) => string | null,
): string {
  const structured = case_[field];
  const trimmed = structured.trim();
  if (trimmed !== '' && trimmed !== '—') return structured;
  if (!case_.workflowSnapshot) return structured;
  const index = findChecklistIndexForCaseField(case_.workflowSnapshot.intake, field);
  if (index === null) return structured;
  const fieldValue = case_.fieldValues[index];
  if (!fieldValue || fieldValue.trim() === '') return structured;
  if (!normalizeLegacyValue) return fieldValue;
  return normalizeLegacyValue(fieldValue) ?? structured;
}

/** Item #7 (2026-09, decedent avatar fix). Derives the case avatar's
    initials from the decedent's own name — never the assigned staff owner
    (that's `resolveOwner` above, a deliberately separate concept). Falls
    back to "?" only when `decedentName` is itself blank (a genuinely
    unnamed/incomplete case), mirroring `resolveOwner`'s own "?" convention
    for its own, unrelated unresolved case. */
function resolveDecedentInitials(decedentName: string): string {
  return decedentName.trim() === '' ? '?' : initialsFromName(decedentName);
}

/**
 * Task #5 FINAL correction (2026-09). Certifier Information is the
 * reference architecture: Name/Phone are separate, independently-editable
 * structured rows. Family Contact now matches that exact pattern — Name,
 * Phone, AND Email each get their own row, never a combined "NAME — PHONE"
 * textbox. (A prior pass of this fix dropped Phone/Email back out on the
 * theory that Case Information already shows them; the live CRM showed
 * the checklist section needs its own structured rows too, exactly like
 * Certifier.) */
const FAMILY_CONTACT_REQUIRED_CASE_FIELDS = ['nextOfKinName', 'nextOfKinPhone', 'nextOfKinEmail'];

/**
 * The frozen Family Contact checklist item label — verbatim from
 * domain/cases/checklist.ts's CHECKLIST_BY_RAW_STAGE[0][7], the same
 * constant every pre/post-v5 workflowSnapshot persists for this item
 * (mirrors legacyCertifierPresentation.ts's own LEGACY_CERTIFIER_ITEM_LABEL
 * precedent). Used below as a stable, metadata-only identity fallback —
 * see applyFamilyContactPresentation's own comment for why this replaces
 * the old text-value-matching fallback. Guarded against drift from the
 * real constant by this module's own test file.
 */
export const FAMILY_CONTACT_ITEM_LABEL = getChecklistLabels(0)[7];

function familyContactRequiredCaseFieldValues(case_: Case): Record<string, string> {
  return {
    nextOfKinName: normalizeNextOfKinName(case_.nextOfKinName ?? '', case_.nextOfKinPhone ?? ''),
    nextOfKinPhone: case_.nextOfKinPhone ?? '',
    nextOfKinEmail: case_.nextOfKinEmail ?? '',
  };
}

/**
 * Family Contact structured Workflow presentation (2026-09, Task #5 FINAL
 * fix). "Family contact — name, phone number & email" has always been a
 * hasField-backed checklist item combining nextOfKinName + nextOfKinPhone
 * into one joined fieldValues string at intake time (see
 * NewCaseModal.tsx's own comment on that join). This converts it to the
 * same structured multi-field presentation Certifier Information already
 * uses — Name/Phone/Email each their own editable row, reading/writing
 * the already-authoritative Case fields Case Information itself uses,
 * never the joined fieldValues text (which stays exactly as-is, purely
 * historical, in every branch, current or past stage — these are live
 * Case contact fields, not part of the frozen stage snapshot, mirroring
 * legacyCertifierPresentation.ts's own past-stage exception). Unlike
 * Certifier, this item never got a v5-style requiredCaseFields completion
 * upgrade, so `done`/`locked` are left completely untouched here, still
 * governed by whatever resolveChecklist already computed from the
 * historical fieldValues rule.
 *
 * IDENTIFICATION (2026-09, Task #5 FINAL fix — replaces a prior,
 * text-value-based fallback). Primary: find whichever checklist index
 * `nextOfKinName` maps to via the case's own workflowSnapshot.intake
 * (findChecklistIndexForCaseField, the same reverse lookup Weight/Time of
 * Death/Certifier already use) — never a literal label match, so this
 * works for any organization/template shaped this way, not just
 * managed-cremations, and needs no template/schema change at all. This
 * alone is already immune to corrupted data, since it never reads
 * nextOfKinName's or fieldValues' actual text.
 *
 * That primary lookup can still miss for a workflowSnapshot whose intake
 * doesn't wire a checklistItemIndex onto nextOfKinName at all (e.g. an
 * onboarding-provisioned organization's simpler starter template — see
 * domain/onboarding/starterWorkflow.ts). The OLD fallback for that case
 * matched by comparing a still-hasField item's fieldValue text against
 * this case's own *current* nextOfKinName (`fieldValue.startsWith(name +
 * ' — ')`) — which breaks the moment nextOfKinName is itself the
 * corrupted "NAME — PHONE" string (the exact production shape this fix
 * exists for): the check ends up searching for "NAME — PHONE — ", which
 * never appears, so identification silently fails and the raw legacy
 * textbox renders. The fix: fall back to matching the item's own LABEL
 * against FAMILY_CONTACT_ITEM_LABEL, the frozen, immutable string every
 * workflowSnapshot persists for this item — stable template/snapshot
 * metadata, exactly like legacyCertifierPresentation.ts's label match, and
 * completely independent of nextOfKinName/fieldValues' current text. This
 * correctly identifies the item for clean cases, legacy cases, and
 * corrupted-nextOfKinName cases alike. */
function applyFamilyContactPresentation(items: ChecklistItemViewModel[], case_: Case): ChecklistItemViewModel[] {
  if (!case_.workflowSnapshot) return items;
  const familyContactIndex = findChecklistIndexForCaseField(case_.workflowSnapshot.intake, 'nextOfKinName');
  let idx = familyContactIndex === null ? -1 : items.findIndex((item) => item.index === familyContactIndex && item.hasField);

  if (idx === -1) {
    idx = items.findIndex((item) => item.hasField && item.label === FAMILY_CONTACT_ITEM_LABEL);
  }
  if (idx === -1) return items;

  const result = [...items];
  result[idx] = {
    ...items[idx],
    hasField: false,
    fieldValue: '',
    isDerived: true,
    requiredCaseFields: FAMILY_CONTACT_REQUIRED_CASE_FIELDS,
    requiredCaseFieldValues: familyContactRequiredCaseFieldValues(case_),
  };
  return result;
}

/**
 * Manors Intake & JotForm uppercase labels (2026-10). Render-time only.
 *
 * Applies to the two canonical display stages that present as the single
 * combined "Intake & JotForm" stage, and only for an organization the
 * overlay recognizes — the decision itself lives in
 * domain/organization/workflowStagePresentation.ts, keyed on the stable
 * `organizationId` plus a canonical-label shape guard, never on a mutable
 * display name. Every other organization, and every later stage, is
 * returned untouched.
 *
 * The stored `ChecklistItemTemplate.label` in the frozen workflowSnapshot
 * is never modified, so composite checklist keys, template comparisons,
 * and the label-matching fallbacks above (e.g. Family Contact's) all keep
 * working against the original casing.
 */
function applyCombinedIntakeLabelCase(
  items: ChecklistItemViewModel[],
  case_: Case,
  canonicalStageLabels: readonly string[],
  canonicalDisplayStage: number,
): ChecklistItemViewModel[] {
  if (!presentsCombinedIntakeLabelsUppercase(case_.organizationId, canonicalStageLabels)) return items;
  // The combined group is canonical display stages 0 and 1; later stages
  // keep their own casing.
  if (canonicalDisplayStage > 1) return items;
  return items.map((item) => ({ ...item, label: item.label.toUpperCase() }));
}

/**
 * Auto-required documents by stage — ported from design/support.js's
 * buildCase(). Uses raw stage thresholds directly, matching the source
 * exactly. Uploaded documents (from the compliance/document service, see
 * docs/ARCHITECTURE.md) are merged in by the caller in Phase 6 — this only
 * computes the stage-driven baseline, which is pure domain logic with no
 * service dependency. Unchanged by Phase 11 (see docs/TEMPLATE_VERSIONING.md's
 * "Known scope limits" — required-document rules aren't templatized this
 * phase; Managed Cremations is the only organization with real documents).
 */
function buildRequiredDocuments(rawStage: number): RequiredDocumentViewModel[] {
  if (rawStage >= 4) {
    return [
      { label: 'Death Certificate', status: rawStage >= 5 ? 'filed' : 'pending' },
      { label: 'Cremation Permit', status: 'signed' },
    ];
  }
  return [{ label: 'Cremation Authorization', status: rawStage >= 3 ? 'signed' : 'pending' }];
}

/**
 * Phase 11 (Workflow Template Architecture): stage/checklist/SLA resolution
 * now reads case_.workflowSnapshot (via domain/workflow/*) instead of the
 * hardcoded domain/cases/stages.ts constants — this is what actually lets a
 * differently-shaped organization's case resolve correctly through this
 * exact function, not a parallel/untested path. Managed Cremations behaves
 * identically to before because its snapshot is built from those same
 * constants (see services/__mocks__/workflowTemplates.ts).
 */
export function buildCaseViewModel(case_: Case, context: CaseViewModelContext): CaseViewModel {
  const { staffList, viewingDisplayStage = null } = context;

  const snapshot = case_.workflowSnapshot;
  if (!snapshot) {
    throw new Error(`Case ${case_.id} has no workflowSnapshot — cannot resolve its stages/checklist`);
  }

  const rawDisplayStage = findStageByRawStage(snapshot, case_.rawStage)?.displayStage ?? 0;
  const currentStageItems = findStageByRawStage(snapshot, case_.rawStage)?.checklist.items ?? [];
  const lastStage = lastDisplayStage(snapshot);
  // Computed here (rather than alongside the presented-stage derivation
  // further down) because the checklist presentation below needs it too —
  // one derivation, used by both.
  const canonicalStageLabels = displayStagesInOrder(snapshot).map((stage) => stage.label);

  // Conditional shipping/tracking (2026-09): the terminal return-of-remains
  // requirement is now derived from structured data (returnMethod +
  // pickupStatus/shippingDeliveryStatus), never from an independently
  // toggled checkbox — see domain/cases/returnMethod.ts and
  // domain/cases/transitions.ts's own comment. `remainsReturnComplete` is
  // computed once here and drives both the effective-stage rollback below
  // and the terminal checklist item's overridden label/done state, so the
  // two can never drift apart into competing signals.
  const remainsReturnComplete = isTerminalReturnRequirementComplete(case_);
  const currentChecklist = applyCombinedIntakeLabelCase(
    applyFamilyContactPresentation(
      applyLegacyCertifierPresentation(resolveChecklist(currentStageItems, rawDisplayStage, case_), case_, false),
      case_,
    ),
    case_,
    canonicalStageLabels,
    rawDisplayStage,
  );
  // The immutable workflowSnapshot still carries its original "Family
  // picked up ashes" item text (never rewritten — see this project's
  // append-only-snapshot discipline); when the case is actually sitting at
  // the terminal stage, its one checklist item is overridden at render
  // time only, to reflect the derived, return-method-aware label/done
  // state, and marked isDerived so ChecklistCard renders it as a read-only
  // indicator rather than a toggle a staff member could contradict.
  const effectiveCurrentChecklist =
    rawDisplayStage === lastStage && currentChecklist.length > 0
      ? [
          {
            ...currentChecklist[0],
            label: terminalReturnRequirementLabel(case_.returnMethod),
            done: remainsReturnComplete,
            locked: false,
            isDerived: true,
            // The structured record this item is derived FROM, carried so
            // the checklist can offer a way to record it. Read-only data —
            // the card writes back through the same case PATCH the Case
            // Information card uses, never through checklistState.
            returnRequirement: {
              returnMethod: case_.returnMethod,
              pickupReleasedTo: case_.pickupReleasedTo,
              pickupReleasedAt: case_.pickupReleasedAt,
              pickupNote: case_.pickupNote,
              shippingDeliveryStatus: case_.shippingDeliveryStatus,
              shippingDeliveredAt: case_.shippingDeliveredAt,
            },
          },
          ...currentChecklist.slice(1),
        ]
      : currentChecklist;
  // Case list scalability, Phase 3 (progress indicator, 2026-09). Keyed
  // off `rawDisplayStage` — the case's TRUE current display stage from
  // its own `rawStage` — never `effectiveDisplayStage` below, which can
  // roll back one position purely as a stepper/label presentation choice
  // for the terminal stage (see resolveEffectiveDisplayStage's own
  // comment). Progress must track the real stage the checklist UI is
  // actually resolved against (effectiveCurrentChecklist, computed from
  // `case_.rawStage` directly above), not that presentational rollback —
  // otherwise this would double-resolve the wrong stage's checklist.
  const caseProgress = computeCaseProgress(snapshot, rawDisplayStage, effectiveCurrentChecklist, case_.organizationId);
  const effectiveDisplayStage = resolveEffectiveDisplayStage(rawDisplayStage, lastStage, remainsReturnComplete);
  const effectiveStage = findStageByDisplayStage(snapshot, effectiveDisplayStage);
  // Manors intake-stage combination (2026-10). The ordered canonical
  // labels from this case's own frozen snapshot, and the user-facing list
  // derived from them. For every organization but Manors these are
  // identical; for Manors the two historical intake stages present as one
  // ("Intake & JotForm"). Presentation only — `effectiveDisplayStage`
  // below stays canonical, so checklist resolution, composite checklist
  // keys, SLA, progress, and advancement are all untouched. See
  // domain/organization/workflowStagePresentation.ts.
  const presented = presentedStages(case_.organizationId, canonicalStageLabels);
  const presentedLabels = presented.map((stage) => stage.label);
  const presentedDisplayStage = toPresentedStageIndex(
    case_.organizationId,
    effectiveDisplayStage,
    canonicalStageLabels,
  );
  const stageLabel = presentedLabels[presentedDisplayStage] ?? effectiveStage?.label ?? '';
  // Case Detail-only presentational overlay (never the structural STAGES/
  // snapshot label sla.ts, the dashboard, and reports key off) — see
  // domain/cases/returnMethod.ts#returnMethodStageHeading's own comment.
  const caseDetailStageHeading =
    effectiveDisplayStage === lastStage - 1 ? returnMethodStageHeading(case_.returnMethod) : stageLabel;

  const owner = resolveOwner(case_, staffList);
  // Used for attribution wherever an actor name is needed but the case may
  // be unowned (the timeline, and Phase 6's case log author) — ported from
  // design/support.js's repeated `raw.owner === '—' ? 'Office' : raw.owner`.
  // Named once here so it isn't re-derived at each call site.
  const effectiveOwnerName = owner.name === '—' ? 'Office' : owner.name;
  const slaTargetDays = effectiveStage?.slaTargetDays ?? null;
  const vaSteps = buildVaSteps(case_);

  // needsAttention/attentionReason: faithfully reproduces design/support.js's
  // actual behavior, which is driven solely by `isStalled` — see the
  // "Correction (Phase 4)" note in docs/BUSINESS_RULES.md. The
  // veteran-incomplete branch below is preserved for parity with the source
  // (attentionReason still computes it) but is unreachable via
  // `needsAttention`, exactly as in the original.
  const needsAttention = case_.isStalled;
  const attentionReason = case_.isStalled
    ? (case_.stalledReason ?? '')
    : needsVeteranAttention(case_)
      ? 'Veteran — VA process incomplete'
      : '';

  // Ported from design/support.js's buildCase(): `nextAction` is the first
  // not-yet-done checklist item's label, falling back to "Review case".
  // `rowSubtext`/`actionColor` there duplicate the same
  // stalled-reason-or-next-action fallback in two separate row templates —
  // computed once here instead (nextActionLabel/rowSummaryText/Variant) so
  // Phase 5's two list components (AllCasesList, StageFilteredPanel) share
  // it rather than re-deriving it.
  const firstUndoneItem = effectiveCurrentChecklist.find((item) => !item.done);
  const nextActionLabel = firstUndoneItem?.label ?? 'Review case';

  /**
   * Case status label (2026-10). The list row used to show only
   * "stalled reason, else next action" — so a case that had finished
   * everything fell through to the `nextActionLabel` fallback and sat
   * there reading "Review case" forever, with nothing left to review.
   *
   * Completion is the SAME signal that makes the stage badge read
   * "Completed": `effectiveDisplayStage` reaching the template's own last
   * stage. `resolveEffectiveDisplayStage` only allows that once
   * `isTerminalReturnRequirementComplete` is true, so the label flips the
   * moment the family release (or confirmed shipping delivery) is
   * recorded — and never because the crematory released the ashes to the
   * funeral home, which is a different event entirely (see
   * domain/cases/returnMethod.ts). Never a hardcoded stage number and
   * never a status string: a template with a different stage count
   * resolves correctly through `lastStage`.
   *
   * Archiving is NOT required to show Completed, and is not what makes a
   * case complete — it is a separate, later filing action.
   *
   * Precedence, highest first:
   *   Archived   — the case is filed away; its stalled reason is moot.
   *   Completed  — nothing is outstanding, so a stale `isStalled` flag
   *                must not keep showing a blocker that no longer exists.
   *   Stalled    — the existing red blocker text, unchanged.
   *   Next action — the existing neutral behaviour, unchanged.
   */
  const isWorkflowComplete = effectiveDisplayStage === lastStage;
  const rowSummaryText = case_.isDeleted
    ? 'Archived'
    : isWorkflowComplete
      ? 'Completed'
      : case_.isStalled
        ? (case_.stalledReason ?? '')
        : nextActionLabel;
  const rowSummaryVariant: CaseRowSummaryVariant = case_.isDeleted
    ? 'archived'
    : isWorkflowComplete
      ? 'success'
      : case_.isStalled
        ? 'danger'
        : 'neutral';

  // A stage the case has already moved beyond is complete by definition
  // (see domain/workflow/resolveChecklist.ts's doc comment) — determined
  // here from the case's own effective stage, not assumed from how the
  // caller (the StageStepper) happens to restrict which stages are
  // clickable.
  const viewedStage = viewingDisplayStage != null ? findStageByDisplayStage(snapshot, viewingDisplayStage) : null;
  const viewedChecklist =
    viewingDisplayStage != null
      ? applyCombinedIntakeLabelCase(
          applyFamilyContactPresentation(
            applyLegacyCertifierPresentation(
              resolveChecklist(
                viewedStage?.checklist.items ?? [],
                viewingDisplayStage,
                case_,
                { isPastStage: viewingDisplayStage < effectiveDisplayStage },
              ),
              case_,
              viewingDisplayStage < effectiveDisplayStage,
            ),
            case_,
          ),
          case_,
          canonicalStageLabels,
          viewingDisplayStage,
        )
      : effectiveCurrentChecklist;

  return {
    id: case_.id,
    caseNumber: case_.caseNumber,
    decedentName: case_.decedentName,
    decedentInitials: resolveDecedentInitials(case_.decedentName),
    dateOfBirth: case_.dateOfBirth,
    dateOfDeath: case_.dateOfDeath,
    timeOfDeath: resolveFieldWithLegacyFallback(case_, 'timeOfDeath', parseLegacyTimeOfDeath),
    placeOfDeath: case_.placeOfDeath,

    displayStage: effectiveDisplayStage,
    stageLabel,
    caseDetailStageHeading,
    stageBadgeVariant: effectiveStage?.isAttentionStage ? 'danger' : 'neutral',

    ownerStaffId: case_.assignedStaffId,
    ownerName: owner.name,
    ownerInitials: owner.initials,
    effectiveOwnerName,

    weight: resolveFieldWithLegacyFallback(case_, 'weight'),
    weightOver200: parseInt(resolveFieldWithLegacyFallback(case_, 'weight'), 10) > 200,

    daysWaitingInStage: case_.daysWaitingInStage,
    slaTargetDays,
    slaTargetLabel: formatSlaTarget(slaTargetDays),
    isOverdue: isOverdue(slaTargetDays, case_.daysWaitingInStage, effectiveDisplayStage, snapshot),

    isStalled: case_.isStalled,
    stalledReason: case_.stalledReason,
    needsAttention,
    attentionReason,
    nextActionLabel,
    rowSummaryText,
    rowSummaryVariant,

    paymentStatus: case_.paymentStatus,
    paymentStatusVariant: case_.paymentStatus === 'paid_in_full' ? 'success' : 'brand',

    isVeteran: case_.isVeteran,
    veteranFlagLocked: isVeteranFlagLocked(case_.rawStage),
    vaSteps,
    vaAllStepsDone: VA_STEPS.every((_, index) => vaSteps[index]?.done ?? false),
    vaCallbackDone: isVaCallbackDone(case_),
    vaPublishChoice: case_.vaPublishChoice,
    vaNotificationResponsibility: case_.vaNotificationResponsibility,
    vaComplete: isVaComplete(case_),

    checklist: viewedChecklist,
    viewingDisplayStage,

    progressPercent: caseProgress.percent,
    progressCompletedItems: caseProgress.completedItems,
    progressTotalItems: caseProgress.totalItems,

    timeline: buildTimeline(case_, effectiveCurrentChecklist, rawDisplayStage, effectiveOwnerName, snapshot),
    requiredDocuments: buildRequiredDocuments(case_.rawStage),

    // Ordered USER-FACING stage labels for this case's own organization,
    // derived from the case's own snapshot — lets the Case Detail page
    // build its stepper from real per-case template data instead of the
    // hardcoded STAGES constant. For Manors the two historical intake
    // stages appear here as one combined entry, so this list is six long
    // where `displayStage` still counts seven canonical positions; index
    // into it with `presentedDisplayStage`, never `displayStage`.
    stageLabels: presentedLabels,
    presentedDisplayStage,
    canonicalDisplayStagesByPresentedIndex: presented.map((stage) => stage.canonicalDisplayStages),
  };
}

/**
 * Triage ordering for a case list — stalled cases first, then longest-waiting
 * first — ported from design/support.js's searchFilteredCases sort. This is
 * a business-meaningful prioritization rule (which cases most need eyes on),
 * not generic list plumbing, so it lives here rather than being inlined in
 * whichever page happens to render a case list first (currently the
 * Dashboard; Phase 6+ screens can reuse this same comparator).
 */
export function compareCasesByUrgency(a: CaseViewModel, b: CaseViewModel): number {
  return Number(b.isStalled) - Number(a.isStalled) || b.daysWaitingInStage - a.daysWaitingInStage;
}
