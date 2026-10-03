/**
 * SOLIS Final Phase, §8.3 — presentation-only label remap, shared by
 * CaseActivityTab, ActivityEventList (Audit Center) and the Phase 1
 * RecentActivityPanel. Stored descriptions never change.
 */
const DISPLAY_LABELS: Record<string, string> = {
  'Case updated (checklistState)': 'Checklist updated',
};

export function activityDisplayLabel(description: string): string {
  return DISPLAY_LABELS[description] ?? description;
}
