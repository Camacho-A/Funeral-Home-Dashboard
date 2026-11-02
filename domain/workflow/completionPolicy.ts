import type {
  CompletionItemRef,
  ManualCompletionPermission,
  StageTemplate,
  WorkflowCompletionPolicy,
  WorkflowTemplate,
  WorkflowTemplateVersion,
  WorkflowVersionSource,
} from '../../types/workflowTemplate';
import type { WorkflowValidationLevel, WorkflowValidationProblem } from './templateValidation';
import { groupStagesByDisplayStage } from './templateEditing';

/**
 * Service-specific completion (2026-10). What "this case is finished"
 * means, as CONFIGURATION on a workflow template version instead of the
 * one universal cremation rule the engine used to hardcode ("the case sits
 * on its last stage AND the cremated remains were returned to the
 * family"). That rule could never be met by a burial or an entombment —
 * nothing is returned — so those cases could never read Completed or
 * archive themselves.
 *
 * THE MODEL (types/workflowTemplate.ts#WorkflowCompletionPolicy)
 *   - kind / requiresRemainsReturn — 'remains_return' (cremation: the
 *     return of remains, recorded as a pickup release or a confirmed
 *     delivery, is required) or 'final_items' (nothing is returned; the
 *     required final items decide).
 *   - requiredFinalItems — checklist items of the FINAL stage or the stage
 *     before it that must be done. Addressed like stored completion
 *     ("{displayStage}:{index}") plus the label they were chosen with, so
 *     an edit that moves or renames one is caught at approval instead of
 *     silently re-pointing the requirement.
 *   - manualCompletion — whether staff holding an existing permission may
 *     complete a case on its final stage by hand (audited, with a reason).
 *     Never a substitute for the return of remains.
 *   - archiveEligibility — whether completion archives the case.
 *
 * ABSENT = TODAY. A version or snapshot without a policy is judged by
 * LEGACY_COMPLETION_POLICY, which is exactly the old hardcoded rule — so
 * Manors, evergreen and every snapshot frozen before this field existed
 * behave byte-for-byte as before. The policy is copied onto each case's
 * frozen snapshot at creation (domain/workflow/snapshot.ts), so a later
 * edit never changes how an existing case completes. Evaluation lives in
 * domain/cases/completionEligibility.ts; this module is the configuration
 * side — defaults, editor operations, validation, and the
 * unfinished-workflow checks that approval runs.
 */

/** The existing permissions a manual completion may be gated by. */
export const MANUAL_COMPLETION_PERMISSIONS: readonly { permission: ManualCompletionPermission; label: string }[] = [
  { permission: 'case.delete', label: 'Owners / administrators (case.delete)' },
  { permission: 'case.update', label: 'Anyone who can edit cases (case.update)' },
];

/** The default gate: the narrowest existing case permission — the same
    one that may delete/archive a case outright. */
export const DEFAULT_MANUAL_COMPLETION_PERMISSION: ManualCompletionPermission = 'case.delete';

/** The note on a draft whose service-specific completion steps have not
    been supplied. Informational only — see the drafts in
    domain/workflow/gusServiceWorkflows.ts. */
export const COMPLETION_REQUIREMENTS_TO_BE_DEFINED_NOTE = 'Service-specific completion requirements to be defined.';

/** A cremation policy: the return of remains, plus any listed items. */
export function remainsReturnCompletionPolicy(
  options: { requiredFinalItems?: CompletionItemRef[]; note?: string | null } = {},
): WorkflowCompletionPolicy {
  return {
    kind: 'remains_return',
    requiresRemainsReturn: true,
    requiredFinalItems: [...(options.requiredFinalItems ?? [])],
    manualCompletion: { allowed: false },
    archiveEligibility: 'on_completion',
    ...(options.note ? { note: options.note } : {}),
  };
}

/** A policy decided by checklist items alone — no remains are returned.
    With no items it is "not defined yet" (never completes, cannot be
    approved). */
export function finalItemsCompletionPolicy(
  options: { requiredFinalItems?: CompletionItemRef[]; note?: string | null } = {},
): WorkflowCompletionPolicy {
  return {
    kind: 'final_items',
    requiresRemainsReturn: false,
    requiredFinalItems: [...(options.requiredFinalItems ?? [])],
    manualCompletion: { allowed: false },
    archiveEligibility: 'on_completion',
    ...(options.note ? { note: options.note } : {}),
  };
}

/** Today's universal rule, as a policy. Frozen: never mutate it. */
export const LEGACY_COMPLETION_POLICY: Readonly<WorkflowCompletionPolicy> = Object.freeze(remainsReturnCompletionPolicy());

/** The policy a version or snapshot is judged by — its own, else today's
    rule. A fresh copy, safe for callers to keep. */
export function effectiveCompletionPolicy(
  source: { completionPolicy?: WorkflowCompletionPolicy | null } | null | undefined,
): WorkflowCompletionPolicy {
  return structuredClone(source?.completionPolicy ?? LEGACY_COMPLETION_POLICY);
}

// ---------------------------------------------------------------------------
// Required final items — what may be chosen, and editor operations
// ---------------------------------------------------------------------------

export type CompletionItemOption = {
  ref: CompletionItemRef;
  stageLabel: string;
  /** 0-based display-stage position (the same as ref.displayStage). */
  stagePosition: number;
};

/**
 * The items a policy may require: the final display stage's and the one
 * before it — "the last things that happen" — read from the template's
 * OWN content, never a fixed list. Each display stage's primary raw stage
 * carries the item list (raw stages sharing a display stage share it).
 */
export function completionItemOptions(stages: readonly StageTemplate[]): CompletionItemOption[] {
  const groups = groupStagesByDisplayStage(stages);
  const eligible = groups.slice(Math.max(groups.length - 2, 0));
  return eligible.flatMap((group) => {
    const primary = group[0];
    return primary.checklist.items.map((item) => ({
      ref: { displayStage: primary.displayStage, index: item.index, label: item.label },
      stageLabel: primary.label,
      stagePosition: primary.displayStage,
    }));
  });
}

export function sameItemRef(a: CompletionItemRef, b: CompletionItemRef): boolean {
  return a.displayStage === b.displayStage && a.index === b.index;
}

/** Adds the item to the required list, or removes it when already there.
    A stale entry at the same position (a different label — the item there
    changed) is replaced, never toggled off by mistake. */
export function toggleRequiredFinalItem(policy: WorkflowCompletionPolicy, ref: CompletionItemRef): WorkflowCompletionPolicy {
  const present = policy.requiredFinalItems.some((entry) => sameItemRef(entry, ref) && entry.label === ref.label);
  const others = policy.requiredFinalItems.filter((entry) => !sameItemRef(entry, ref));
  const requiredFinalItems = present
    ? others
    : [...others, { displayStage: ref.displayStage, index: ref.index, label: ref.label }].sort(
        (a, b) => a.displayStage - b.displayStage || a.index - b.index,
      );
  return { ...policy, requiredFinalItems };
}

/** Switches between the two kinds; `kind` and `requiresRemainsReturn`
    always move together. */
export function setRemainsReturnRequired(policy: WorkflowCompletionPolicy, required: boolean): WorkflowCompletionPolicy {
  return { ...policy, kind: required ? 'remains_return' : 'final_items', requiresRemainsReturn: required };
}

export function setManualCompletion(
  policy: WorkflowCompletionPolicy,
  manualCompletion: WorkflowCompletionPolicy['manualCompletion'],
): WorkflowCompletionPolicy {
  return {
    ...policy,
    manualCompletion: manualCompletion.allowed
      ? { allowed: true, permission: manualCompletion.permission ?? DEFAULT_MANUAL_COMPLETION_PERMISSION }
      : { allowed: false },
  };
}

/** Required items that no longer resolve to the item they were chosen
    with (moved, renamed, removed, or no longer in the last two stages). */
export function staleRequiredFinalItems(policy: WorkflowCompletionPolicy, stages: readonly StageTemplate[]): CompletionItemRef[] {
  const options = completionItemOptions(stages);
  return policy.requiredFinalItems.filter(
    (ref) => !options.some((option) => sameItemRef(option.ref, ref) && option.ref.label === ref.label),
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const KINDS = new Set(['remains_return', 'final_items']);
const PERMISSIONS = new Set<string>(MANUAL_COMPLETION_PERMISSIONS.map((entry) => entry.permission));
const ARCHIVE = new Set(['on_completion', 'manual']);

/**
 * THE validation of a completion policy against the stages it belongs to —
 * pure, shared by the editor and (authoritatively) the versions and
 * approve routes, via domain/workflow/templateValidation.ts.
 *
 * 'draft' — coherent enough to store: a known kind that agrees with
 * requiresRemainsReturn, well-formed item references, a known manual
 * completion permission and archive setting.
 *
 * 'approval' — complete enough for live cases:
 *   - a 'final_items' policy lists at least one required item (an empty
 *     list is "to be defined": a case could never complete — or, if it
 *     did, it would complete on nothing);
 *   - every required item still resolves to the item it was chosen with,
 *     in the final stage or the stage before it;
 *   - no item is listed twice.
 */
export function validateCompletionPolicy(
  policy: WorkflowCompletionPolicy,
  stages: readonly StageTemplate[],
  level: WorkflowValidationLevel,
): WorkflowValidationProblem[] {
  const problems: WorkflowValidationProblem[] = [];
  const add = (code: string, message: string, at: WorkflowValidationLevel = 'draft') => problems.push({ code, message, level: at });

  if (!KINDS.has(policy.kind)) {
    add('completion_kind_invalid', 'Choose how a case of this service is completed.');
  } else if (policy.requiresRemainsReturn !== (policy.kind === 'remains_return')) {
    add('completion_kind_mismatch', 'The completion rule is inconsistent — "requires return of cremated remains" must match the completion kind.');
  }
  const refsWellFormed = policy.requiredFinalItems.every(
    (ref) => Number.isInteger(ref.displayStage) && ref.displayStage >= 0 && Number.isInteger(ref.index) && ref.index >= 0 && typeof ref.label === 'string',
  );
  if (!refsWellFormed) add('completion_items_malformed', 'A required final item is malformed.');
  if (policy.manualCompletion.allowed && policy.manualCompletion.permission !== undefined && !PERMISSIONS.has(policy.manualCompletion.permission)) {
    add('completion_manual_permission_invalid', 'Manual completion must be gated by an existing case permission.');
  }
  if (!ARCHIVE.has(policy.archiveEligibility)) add('completion_archive_invalid', 'Choose when a completed case is archived.');

  if (level === 'draft' || !refsWellFormed) return problems;

  if (policy.kind === 'final_items' && policy.requiredFinalItems.length === 0) {
    add(
      'completion_items_undefined',
      'Completion requirements are not defined — choose the final checklist item(s) that complete a case of this service (Completion section). Without them a case could never be completed.',
      'approval',
    );
  }
  for (const ref of staleRequiredFinalItems(policy, stages)) {
    add(
      'completion_item_stale',
      `Required final item "${ref.label}" is no longer in the final stage or the stage before it — choose the completion items again.`,
      'approval',
    );
  }
  const seen = new Set<string>();
  for (const ref of policy.requiredFinalItems) {
    const key = `${ref.displayStage}:${ref.index}`;
    if (seen.has(key)) add('completion_item_duplicate', `Required final item "${ref.label}" is listed more than once.`, 'approval');
    seen.add(key);
  }
  return problems;
}

/** Shape check for an untrusted request body's `completionPolicy` —
    returns the normalized policy, or the reasons it is not one. */
export function parseCompletionPolicy(value: unknown): { policy: WorkflowCompletionPolicy | null; errors: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { policy: null, errors: ['completionPolicy must be an object.'] };
  const raw = value as Record<string, unknown>;
  const errors: string[] = [];
  if (raw.kind !== 'remains_return' && raw.kind !== 'final_items') errors.push('completionPolicy.kind must be "remains_return" or "final_items".');
  if (typeof raw.requiresRemainsReturn !== 'boolean') errors.push('completionPolicy.requiresRemainsReturn must be a boolean.');
  const items = raw.requiredFinalItems;
  if (
    !Array.isArray(items) ||
    !items.every(
      (ref) =>
        ref &&
        typeof ref === 'object' &&
        Number.isInteger((ref as Record<string, unknown>).displayStage) &&
        Number.isInteger((ref as Record<string, unknown>).index) &&
        typeof (ref as Record<string, unknown>).label === 'string',
    )
  ) {
    errors.push('completionPolicy.requiredFinalItems must be a list of { displayStage, index, label }.');
  }
  const manual = raw.manualCompletion as Record<string, unknown> | undefined;
  if (!manual || typeof manual !== 'object' || typeof manual.allowed !== 'boolean') {
    errors.push('completionPolicy.manualCompletion.allowed must be a boolean.');
  } else if (manual.permission !== undefined && !PERMISSIONS.has(manual.permission as string)) {
    errors.push('completionPolicy.manualCompletion.permission must be an existing case permission.');
  }
  if (!ARCHIVE.has(raw.archiveEligibility as string)) errors.push('completionPolicy.archiveEligibility must be "on_completion" or "manual".');
  if (raw.note !== undefined && raw.note !== null && typeof raw.note !== 'string') errors.push('completionPolicy.note must be text.');
  if (errors.length > 0) return { policy: null, errors };

  const refs = (items as Record<string, unknown>[]).map((ref) => ({
    displayStage: ref.displayStage as number,
    index: ref.index as number,
    label: ref.label as string,
  }));
  return {
    policy: {
      kind: raw.kind as WorkflowCompletionPolicy['kind'],
      requiresRemainsReturn: raw.requiresRemainsReturn as boolean,
      requiredFinalItems: refs,
      manualCompletion: (manual as { allowed: boolean }).allowed
        ? { allowed: true, permission: ((manual as Record<string, unknown>).permission as ManualCompletionPermission | undefined) ?? DEFAULT_MANUAL_COMPLETION_PERMISSION }
        : { allowed: false },
      archiveEligibility: raw.archiveEligibility as WorkflowCompletionPolicy['archiveEligibility'],
      ...(typeof raw.note === 'string' && raw.note.trim() !== '' ? { note: raw.note } : {}),
    },
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Unfinished-workflow protection — placeholders and unmodified copies
// ---------------------------------------------------------------------------

/** The suffix every "not supplied yet" stage carries
    (domain/workflow/gusServiceWorkflows.ts#gusPlaceholderStageLabel). */
export const PLACEHOLDER_STAGE_SUFFIX = 'steps to be defined';

/** A stage whose label says its steps have not been defined — refused at
    approval even if someone added an item to it without renaming it. */
export function isPlaceholderStageLabel(label: string): boolean {
  return label.trim().toLowerCase().endsWith(PLACEHOLDER_STAGE_SUFFIX);
}

/** Key-order-independent JSON, so content read back from Wix compares
    equal to the same content built in code. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The completion requirements that change behaviour — the note is
    excluded (adding a "to be defined" note to a copy does not make it
    reviewed). */
function completionRequirementsKey(policy: WorkflowCompletionPolicy | null | undefined): string {
  const requirements: Partial<WorkflowCompletionPolicy> = effectiveCompletionPolicy({ completionPolicy: policy ?? undefined });
  delete requirements.note;
  return canonicalJson(requirements);
}

/** Whether two versions' stages, checklist items and completion
    requirements are identical. */
export function sameWorkflowContent(
  a: Pick<WorkflowTemplateVersion, 'stages' | 'completionPolicy'>,
  b: Pick<WorkflowTemplateVersion, 'stages' | 'completionPolicy'>,
): boolean {
  return canonicalJson(a.stages) === canonicalJson(b.stages) && completionRequirementsKey(a.completionPolicy) === completionRequirementsKey(b.completionPolicy);
}

/**
 * The template a version is still an UNMODIFIED copy of — its stages,
 * checklist items and completion requirements identical to a version of
 * another template. Checked against:
 *   - the template its `derivedFrom` names — ANY of that template's
 *     versions, not only the one copied (a copy that matches a later
 *     version of its source is still not this service's own workflow);
 *   - failing that, the APPROVED versions of every other template of the
 *     organization: a version provisioned before `derivedFrom` existed
 *     carries no marker, and two services that genuinely share one
 *     workflow are served by assigning both to one template, never by two
 *     identical ones. Approved only — so editing Direct Cremation is never
 *     mistaken for "a copy of" one of its own still-draft copies.
 * Null when the version matches nothing, i.e. it has been made its own.
 */
export function findUnmodifiedCopySource(
  version: Pick<WorkflowTemplateVersion, 'stages' | 'completionPolicy' | 'composition'> & { derivedFrom?: WorkflowVersionSource | null },
  organizationTemplates: readonly WorkflowTemplate[],
  ownTemplateId?: string,
): WorkflowTemplate | null {
  // Shared workflow foundation (2026-11): services composed from the same
  // shared base legitimately have identical steps until their own are
  // defined (Cremation with Viewing = the cremation process, for now) —
  // that is the design, not an unfinished copy.
  const sameFoundation = (candidate: WorkflowTemplateVersion) =>
    Boolean(version.composition && candidate.composition && version.composition.base.key === candidate.composition.base.key);
  const matches = (template: WorkflowTemplate, approvedOnly: boolean) =>
    template.versions.some(
      (candidate) => (!approvedOnly || candidate.status !== 'draft') && !sameFoundation(candidate) && sameWorkflowContent(version, candidate),
    );
  const named = version.derivedFrom ? organizationTemplates.find((t) => t.id === version.derivedFrom!.templateId) : undefined;
  if (named && named.id !== ownTemplateId && matches(named, false)) return named;
  return organizationTemplates.find((t) => t.id !== ownTemplateId && t !== named && matches(t, true)) ?? null;
}

// ---------------------------------------------------------------------------
// Staff-facing description (editor preview, Settings)
// ---------------------------------------------------------------------------

/** One sentence per rule, in the order a reader needs them. */
export function describeCompletionPolicy(policy: WorkflowCompletionPolicy): string[] {
  const lines: string[] = [];
  lines.push(
    policy.requiresRemainsReturn
      ? 'Completed once the return of cremated remains is recorded (family pickup released, or shipment confirmed delivered).'
      : 'No cremated remains are returned — completion is decided by the required final items.',
  );
  if (policy.requiredFinalItems.length > 0) {
    lines.push(`Required final items: ${policy.requiredFinalItems.map((ref) => `“${ref.label}”`).join(', ')}.`);
  } else if (policy.kind === 'final_items') {
    lines.push('Required final items: not defined yet — a case cannot be completed and this version cannot be approved.');
  }
  lines.push(
    policy.manualCompletion.allowed
      ? `Staff with ${policy.manualCompletion.permission ?? DEFAULT_MANUAL_COMPLETION_PERMISSION} may mark a case on its final stage completed, with a reason (recorded in the activity log)${policy.requiresRemainsReturn ? ' — never without the return of remains' : ''}.`
      : 'Manual completion is not allowed.',
  );
  lines.push(
    policy.archiveEligibility === 'on_completion'
      ? 'A completed case is archived automatically.'
      : 'A completed case stays in the working lists until staff archive it.',
  );
  return lines;
}
