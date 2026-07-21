import type { Case } from '../../types/case';
import type { ChecklistItemViewModel, TimelineEntryViewModel } from '../../types/caseViewModel';
import { lowerFirst } from '../../utils/string';
import { getChecklistLabels } from './checklist';
import { toRawStage } from './stages';

const REMOVAL_TEAM_PATTERN = /removal team|dispatch texted/i;
const FUNERAL_DIRECTOR_PATTERN = /permit signed/i;

/**
 * Which staff role gets attributed a given completed step — ported from
 * design/support.js's actorFor(). A business rule (who does what), not a
 * generic mapping, hence its home in domain/ rather than utils/.
 */
function actorFor(label: string, ownerName: string): string {
  if (REMOVAL_TEAM_PATTERN.test(label)) return 'Removal team';
  if (FUNERAL_DIRECTOR_PATTERN.test(label)) return 'Funeral director';
  return ownerName;
}

/**
 * Auto-derived "story of the case" — built by walking every completed
 * checklist item across every stage already passed through, plus every item
 * completed in the current stage. No separate data-entry step is needed
 * from staff to produce this (see docs/BUSINESS_RULES.md, "Activity
 * Timeline"). `ownerName` should already have the "Office" fallback applied
 * by the caller (see domain/tasks/rules.ts's defaultAssigneeForCase for the
 * same fallback used elsewhere).
 */
export function buildTimeline(
  case_: Case,
  currentChecklist: ChecklistItemViewModel[],
  currentDisplayStage: number,
  ownerName: string,
): TimelineEntryViewModel[] {
  const entries: Array<{ who: string; what: string }> = [];

  for (let displayStage = 0; displayStage < currentDisplayStage; displayStage++) {
    const labels = getChecklistLabels(toRawStage(displayStage));
    labels.forEach((label) =>
      entries.push({ who: actorFor(label, ownerName), what: lowerFirst(label) }),
    );
  }

  currentChecklist
    .filter((item) => item.done)
    .forEach((item) =>
      entries.push({ who: actorFor(item.label, ownerName), what: lowerFirst(item.label) }),
    );

  const total = entries.length;
  return entries.map((entry, index) => ({ ...entry, daysAgo: total - 1 - index })).reverse(); // newest first
}
