import type { ChecklistItemTemplate } from '../../types/workflowTemplate';
import { getRegisteredOrganizationProfile, registeredProfileMap, type RetiredChecklistItem } from './organizationProfiles';

/**
 * Retired checklist items (2026-10).
 *
 * An organization stops using a checklist item. The obvious change —
 * deleting it from the template — is the one thing that must NOT happen
 * here, because `Case.checklistState` is keyed by the item's POSITION
 * (`"{displayStage}:{index}"`, see domain/workflow/checklistItemKey.ts).
 * Removing an item shifts every later item down one, so a stored
 * `"5:2"` meaning "Tag/name/cert cross-checked" would silently start
 * reading as "Labels made". That is exactly the class of corruption the
 * composite-key fix was introduced to end; re-creating it to delete one
 * row would be a poor trade.
 *
 * Nor would deleting it from the template affect existing work anyway:
 * every case carries its OWN frozen `workflowSnapshot`, so in-flight cases
 * would keep showing and requiring the item regardless.
 *
 * So an item is RETIRED rather than removed. It stays in the template and
 * in every snapshot at its original index — history and stored state are
 * untouched and remain exactly as meaningful as before — while
 * `resolveChecklist` stops rendering it and stops counting it toward stage
 * completion. Existing cases therefore advance without it immediately, and
 * reversing the decision is a one-line change here with no data migration.
 *
 * SCOPING. Keyed on the stable `organizationId`, so no other tenant is
 * affected unless explicitly listed — the same discipline
 * domain/organization/cremainsPickupCapability.ts and
 * workflowStagePresentation.ts already use, never a display-name match.
 *
 * SHAPE GUARD. The index is the identifier; the label is checked before
 * anything is hidden. If a template is ever restructured so that index no
 * longer holds the named item, nothing is retired — the item reappears
 * rather than the wrong one quietly disappearing.
 */

export type { RetiredChecklistItem };
export { MANORS_ORGANIZATION_ID } from './organizationProfiles';

/** 2026-10: each organization's retirements now live in its profile
    (`features.retiredChecklistItems`, domain/organization/organizationProfiles.ts).
    This map is derived from that registry, kept for existing importers. */
export const RETIRED_CHECKLIST_ITEMS: Record<string, readonly RetiredChecklistItem[]> = registeredProfileMap(
  (profile) => profile.features.retiredChecklistItems,
  (profile) => profile.features.retiredChecklistItems.length > 0,
);

/**
 * The indices to hide for one organization's stage, verified against the
 * items actually present.
 *
 * Returns an empty set for any organization with no retirements, which is
 * every organization but the ones listed above.
 */
export function retiredChecklistIndices(
  organizationId: string | null | undefined,
  displayStage: number,
  items: readonly Pick<ChecklistItemTemplate, 'label' | 'index'>[],
): ReadonlySet<number> {
  const retired = organizationId ? getRegisteredOrganizationProfile(organizationId).features.retiredChecklistItems : undefined;
  if (!retired || retired.length === 0) return EMPTY;

  const indices = new Set<number>();
  for (const entry of retired) {
    if (entry.displayStage !== displayStage) continue;
    // Shape guard: only ever hide the item that is genuinely there.
    // Looked up by the item's OWN `index`, not by array position — the
    // Medical Examiner variant can legitimately reorder a stage's items,
    // and position would then point at the wrong one.
    const item = items.find((candidate) => candidate.index === entry.index);
    if (item?.label === entry.expectedLabel) indices.add(entry.index);
  }
  return indices.size === 0 ? EMPTY : indices;
}

const EMPTY: ReadonlySet<number> = new Set<number>();

/**
 * How many of a stage's items still count — used wherever a stage's size
 * is needed without resolving its full checklist (progress totals for
 * stages the case is not currently sitting in).
 */
export function activeChecklistItemCount(
  organizationId: string | null | undefined,
  displayStage: number,
  items: readonly Pick<ChecklistItemTemplate, 'label' | 'index'>[],
): number {
  return items.length - retiredChecklistIndices(organizationId, displayStage, items).size;
}
