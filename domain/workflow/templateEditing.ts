import type { ChecklistItemTemplate, IntakeTemplate, StageTemplate } from '../../types/workflowTemplate';

/**
 * Workflow template editor (2026-10). Pure structural operations the
 * Settings › Workflow Templates editor applies to a draft `stages` array
 * before it is saved as a brand-new WorkflowTemplateVersion. Every
 * operation returns a fully renumbered array, so whatever the editor
 * submits is always coherent — the server re-checks it anyway
 * (domain/workflow/templateValidation.ts).
 *
 * THE UNIT OF EDITING IS THE DISPLAY STAGE — what staff see as one stepper
 * dot. A display stage is one or more CONSECUTIVE raw stages sharing a
 * `displayStage` (a "group" here). In the cremation shape Gus and Manors
 * run, display stage 0 is two raw stages — First Call (raw 0) and Payment
 * (raw 1) — that share one label and one combined checklist, and a case's
 * `checklistState` keys ("{displayStage}:{index}") address that shared
 * list. So an edit to a group applies to EVERY raw stage in it, at the
 * same item position.
 *
 * NUMBERING RULES (also in docs/TEMPLATE_VERSIONING.md):
 * - rawStage = the stage's position in the array, from 0, no gaps.
 * - displayStage = the group's position, from 0, no gaps. Raw stages that
 *   shared a display stage keep sharing one (the existing cremation shape
 *   is preserved through every edit, not only when untouched); a stage
 *   added in the editor is always its own group — one raw stage per
 *   display stage — since nothing in the engine needs a new combined
 *   stage and the editor offers no way to ask for one.
 * - item `index` = the item's position in its checklist, from 0. Within a
 *   group every raw stage carries the same item list; only the FIRST raw
 *   stage's items may be data-entry (`hasField`) — later raw stages carry
 *   the same items with `hasField: false`, exactly as the cremation
 *   shape's Payment stage already does.
 *
 * There is no stable item id: an item's identity IS its (display stage,
 * index). That is safe here because a saved version is only ever used by
 * cases created after it; every existing case keeps the frozen
 * `workflowSnapshot` it was created with (domain/workflow/snapshot.ts) and
 * never re-reads a template.
 */

export type StageGroup = StageTemplate[];

/** Consecutive raw stages sharing a displayStage, in array order. */
export function groupStagesByDisplayStage(stages: readonly StageTemplate[]): StageGroup[] {
  const groups: StageGroup[] = [];
  stages.forEach((stage, i) => {
    if (i > 0 && stage.displayStage === stages[i - 1].displayStage) {
      groups[groups.length - 1].push(stage);
    } else {
      groups.push([stage]);
    }
  });
  return groups;
}

function reindexItems(items: ChecklistItemTemplate[]): ChecklistItemTemplate[] {
  return items.map((item, index) => (item.index === index ? item : { ...item, index }));
}

/** Flattens groups back into a stages array, applying the numbering rules
    above. Untouched stages keep their exact object identity when nothing
    about their numbering changed. */
export function flattenStageGroups(groups: readonly StageGroup[]): StageTemplate[] {
  const stages: StageTemplate[] = [];
  groups.forEach((group, displayStage) => {
    group.forEach((stage) => {
      const rawStage = stages.length;
      const items = reindexItems(stage.checklist.items);
      const unchanged =
        stage.rawStage === rawStage && stage.displayStage === displayStage && items.every((item, i) => item === stage.checklist.items[i]);
      stages.push(unchanged ? stage : { ...stage, rawStage, displayStage, checklist: { ...stage.checklist, items } });
    });
  });
  return stages;
}

/** Renumbers an arbitrary stages array by the rules above. */
export function renumberWorkflowStages(stages: readonly StageTemplate[]): StageTemplate[] {
  return flattenStageGroups(groupStagesByDisplayStage(stages));
}

function mapGroup(stages: readonly StageTemplate[], groupIndex: number, fn: (group: StageGroup) => StageGroup): StageTemplate[] {
  const groups = groupStagesByDisplayStage(stages);
  if (groupIndex < 0 || groupIndex >= groups.length) return [...stages];
  return flattenStageGroups(groups.map((group, i) => (i === groupIndex ? fn(group) : group)));
}

/** Applies `fn` to each raw stage's item list in a group. `isPrimary` is
    true for the group's first raw stage — the only one whose items may be
    data-entry. */
function mapGroupItems(
  stages: readonly StageTemplate[],
  groupIndex: number,
  fn: (items: ChecklistItemTemplate[], isPrimary: boolean) => ChecklistItemTemplate[],
): StageTemplate[] {
  return mapGroup(stages, groupIndex, (group) =>
    group.map((stage, i) => ({ ...stage, checklist: { ...stage.checklist, items: fn(stage.checklist.items, i === 0) } })),
  );
}

/**
 * The final display stage's label, trimmed and compared case-insensitively,
 * is exactly "Completed" — the terminal-stage definition shared with
 * validation (domain/workflow/templateValidation.ts).
 */
export const TERMINAL_STAGE_LABEL = 'Completed';

export function isTerminalStageLabel(label: string): boolean {
  return label.trim().toLowerCase() === TERMINAL_STAGE_LABEL.toLowerCase();
}

function uniqueLabel(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((label) => label.trim().toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  let n = 2;
  while (lower.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

// ---------------------------------------------------------------------------
// Stage operations (by display-stage position)
// ---------------------------------------------------------------------------

/**
 * Adds a new, single-raw-stage display stage with an empty checklist.
 * Inserted just before the terminal "Completed" stage when the workflow
 * ends with one (a new step can never come after completion), otherwise
 * at the end. The label is "New stage" (suffixed when taken) — the
 * administrator renames it; an empty checklist is allowed in a draft but
 * blocks approval until items are added.
 */
export function addStage(stages: readonly StageTemplate[], label = 'New stage'): StageTemplate[] {
  const groups = groupStagesByDisplayStage(stages);
  const taken = groups.map((group) => group[0].label);
  const stage: StageTemplate = {
    rawStage: 0,
    displayStage: 0,
    label: uniqueLabel(label, taken),
    isAttentionStage: false,
    slaTargetDays: null,
    checklist: { items: [] },
  };
  const last = groups[groups.length - 1];
  const insertAt = last && isTerminalStageLabel(last[0].label) ? groups.length - 1 : groups.length;
  return flattenStageGroups([...groups.slice(0, insertAt), [stage], ...groups.slice(insertAt)]);
}

/** Removes a whole display stage (every raw stage in it). */
export function removeStage(stages: readonly StageTemplate[], groupIndex: number): StageTemplate[] {
  const groups = groupStagesByDisplayStage(stages);
  if (groupIndex < 0 || groupIndex >= groups.length) return [...stages];
  return flattenStageGroups(groups.filter((_, i) => i !== groupIndex));
}

/** Moves a whole display stage one position up or down; a combined stage
    moves as one unit and stays combined. Out of bounds is a no-op. */
export function moveDisplayStage(stages: readonly StageTemplate[], groupIndex: number, direction: 'up' | 'down'): StageTemplate[] {
  const groups = groupStagesByDisplayStage(stages);
  const target = direction === 'up' ? groupIndex - 1 : groupIndex + 1;
  if (groupIndex < 0 || groupIndex >= groups.length || target < 0 || target >= groups.length) return [...stages];
  const reordered = [...groups];
  [reordered[groupIndex], reordered[target]] = [reordered[target], reordered[groupIndex]];
  return flattenStageGroups(reordered);
}

/** Label / SLA target / attention flag, applied to every raw stage in the
    display stage so a combined stage can never disagree with itself. */
export function updateStage(
  stages: readonly StageTemplate[],
  groupIndex: number,
  patch: Partial<Pick<StageTemplate, 'label' | 'slaTargetDays' | 'isAttentionStage'>>,
): StageTemplate[] {
  return mapGroup(stages, groupIndex, (group) => group.map((stage) => ({ ...stage, ...patch })));
}

// ---------------------------------------------------------------------------
// Checklist item operations (by display-stage position + item position)
// ---------------------------------------------------------------------------

/** Appends a plain checkbox item ("New checklist item", suffixed when
    taken) to every raw stage of the display stage. */
export function addChecklistItem(stages: readonly StageTemplate[], groupIndex: number, label = 'New checklist item'): StageTemplate[] {
  const group = groupStagesByDisplayStage(stages)[groupIndex];
  if (!group) return [...stages];
  const itemLabel = uniqueLabel(label, group[0].checklist.items.map((item) => item.label));
  return mapGroupItems(stages, groupIndex, (items) => [
    ...items,
    { index: items.length, label: itemLabel, hasField: false, isPasswordField: false, externalFormIntegrationId: null },
  ]);
}

export function removeChecklistItem(stages: readonly StageTemplate[], groupIndex: number, itemIndex: number): StageTemplate[] {
  return mapGroupItems(stages, groupIndex, (items) => items.filter((_, i) => i !== itemIndex));
}

export function moveChecklistItem(
  stages: readonly StageTemplate[],
  groupIndex: number,
  itemIndex: number,
  direction: 'up' | 'down',
): StageTemplate[] {
  const target = direction === 'up' ? itemIndex - 1 : itemIndex + 1;
  return mapGroupItems(stages, groupIndex, (items) => {
    if (itemIndex < 0 || itemIndex >= items.length || target < 0 || target >= items.length) return items;
    const reordered = [...items];
    [reordered[itemIndex], reordered[target]] = [reordered[target], reordered[itemIndex]];
    return reordered;
  });
}

/** The item properties the editor exposes — exactly what the engine reads
    (resolveChecklist.ts / ChecklistCard.tsx); `externalFormIntegrationId`
    is carried through untouched, never edited here. */
export type ChecklistItemPatch = Partial<
  Pick<ChecklistItemTemplate, 'label' | 'hasField' | 'isPasswordField' | 'valueKind' | 'requiredCaseFields'>
>;

/**
 * Applies `patch` to the item at `itemIndex` in every raw stage of the
 * display stage. `hasField` only ever lands on the first raw stage (later
 * raw stages stay `hasField: false`, see the numbering rules). Optional
 * properties set to `undefined` are REMOVED rather than stored as
 * undefined, so a cleared requirement leaves the item shaped exactly like
 * one that never had it.
 */
export function updateChecklistItem(
  stages: readonly StageTemplate[],
  groupIndex: number,
  itemIndex: number,
  patch: ChecklistItemPatch,
): StageTemplate[] {
  return mapGroupItems(stages, groupIndex, (items, isPrimary) =>
    items.map((item, i) => {
      if (i !== itemIndex) return item;
      const effective: ChecklistItemPatch = isPrimary ? patch : { ...patch, ...(patch.hasField !== undefined ? { hasField: false } : {}) };
      const next: ChecklistItemTemplate = { ...item };
      for (const [key, value] of Object.entries(effective) as [keyof ChecklistItemPatch, unknown][]) {
        if (value === undefined) delete (next as Record<string, unknown>)[key];
        else (next as Record<string, unknown>)[key] = value;
      }
      return next;
    }),
  );
}

// ---------------------------------------------------------------------------
// Intake coupling — the first display stage
// ---------------------------------------------------------------------------

/**
 * Intake fields seed the FIRST display stage's checklist by item index
 * (IntakeFieldTemplate.checklistItemIndex; resolveChecklist.ts's
 * INTAKE_DISPLAY_STAGE = 0, and Case.fieldValues is keyed by that bare
 * index). The intake fields that point at an existing item of that stage.
 */
export function intakeFieldsLinkedToFirstStageItem(
  stages: readonly StageTemplate[],
  intake: IntakeTemplate,
  itemIndex: number,
): string[] {
  const firstStageItemCount = groupStagesByDisplayStage(stages)[0]?.[0].checklist.items.length ?? 0;
  if (itemIndex >= firstStageItemCount) return [];
  return intake.sections.flatMap((section) =>
    section.fields.filter((field) => field.checklistItemIndex === itemIndex).map((field) => field.label),
  );
}

/** Whether any intake field feeds an existing item of the first display
    stage — while true, the editor keeps that stage first (moving another
    stage into first place would silently re-point those fields at a
    different stage's items). */
export function isFirstStageLinkedToIntake(stages: readonly StageTemplate[], intake: IntakeTemplate): boolean {
  const firstStageItemCount = groupStagesByDisplayStage(stages)[0]?.[0].checklist.items.length ?? 0;
  return intake.sections.some((section) =>
    section.fields.some((field) => field.checklistItemIndex != null && field.checklistItemIndex < firstStageItemCount),
  );
}

/**
 * Re-points intake `checklistItemIndex` values after the first display
 * stage's items were reordered or one was removed, so each field keeps
 * feeding the same item. `previousOrder[newIndex] = oldIndex`. An index not
 * in `previousOrder` — a removed item (the editor refuses to remove an item
 * a field still feeds) or a slot beyond the old item count (a field's own
 * fieldValues slot with no checklist item, which the intake builder
 * deliberately allocates) — is left untouched.
 */
export function remapIntakeAfterFirstStageChange(intake: IntakeTemplate, previousOrder: readonly number[]): IntakeTemplate {
  const newIndexOf = new Map(previousOrder.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  let changed = false;
  const sections = intake.sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      if (field.checklistItemIndex == null || !newIndexOf.has(field.checklistItemIndex)) return field;
      const next = newIndexOf.get(field.checklistItemIndex)!;
      if (next === field.checklistItemIndex) return field;
      changed = true;
      return { ...field, checklistItemIndex: next };
    }),
  }));
  return changed ? { ...intake, sections } : intake;
}

/** The old-index order after moving one item — the `previousOrder` for
    remapIntakeAfterFirstStageChange. */
export function itemOrderAfterMove(itemCount: number, itemIndex: number, direction: 'up' | 'down'): number[] {
  const order = Array.from({ length: itemCount }, (_, i) => i);
  const target = direction === 'up' ? itemIndex - 1 : itemIndex + 1;
  if (itemIndex < 0 || itemIndex >= itemCount || target < 0 || target >= itemCount) return order;
  [order[itemIndex], order[target]] = [order[target], order[itemIndex]];
  return order;
}

/** The old-index order after removing one item. */
export function itemOrderAfterRemoval(itemCount: number, itemIndex: number): number[] {
  return Array.from({ length: itemCount }, (_, i) => i).filter((i) => i !== itemIndex);
}
