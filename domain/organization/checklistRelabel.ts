import type { ChecklistItemTemplate } from '../../types/workflowTemplate';
import { getRegisteredOrganizationProfile, type RelabeledChecklistItem } from './organizationProfiles';

/**
 * Relabeled checklist items (2026-10).
 *
 * An organization wants an existing checklist item worded differently.
 * Editing the template alone would not reach existing work: every case
 * carries its OWN frozen `workflowSnapshot` (docs/TEMPLATE_VERSIONING.md),
 * so in-flight and historical cases would keep the old wording forever.
 * Rewriting those snapshots is exactly the kind of history mutation the
 * snapshot model exists to prevent.
 *
 * So the wording is changed at PRESENTATION time, the same way
 * checklistRetirement.ts hides an item: the snapshot, the item's index,
 * its stored `checklistState`, and every label-matching rule
 * (Medical Examiner variant, payment/family-contact/certifier detection)
 * keep operating on the stored label. Only the text staff read changes.
 * Reversing it is a one-line profile change with no data migration.
 *
 * SCOPING. Keyed on the stable `organizationId` via the organization's
 * profile (`features.relabeledChecklistItems`) — no other tenant is
 * affected unless explicitly listed.
 *
 * SHAPE GUARD. The index is the identifier; the stored label is checked
 * before anything is renamed. If a template is restructured so that index
 * no longer holds the named item, its own label is shown unchanged rather
 * than the wrong item quietly being renamed.
 */

export type { RelabeledChecklistItem };

export function presentedChecklistLabel(
  organizationId: string | null | undefined,
  displayStage: number,
  item: Pick<ChecklistItemTemplate, 'label' | 'index'>,
): string {
  const relabels = organizationId ? getRegisteredOrganizationProfile(organizationId).features.relabeledChecklistItems : undefined;
  if (!relabels || relabels.length === 0) return item.label;
  const entry = relabels.find(
    (candidate) => candidate.displayStage === displayStage && candidate.index === item.index && candidate.expectedLabels.includes(item.label),
  );
  return entry ? entry.label : item.label;
}
