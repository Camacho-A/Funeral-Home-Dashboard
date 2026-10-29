import { getRegisteredOrganizationProfile } from '../organization/organizationProfiles';
import { findStageByRawStage } from './resolveStages';
import { presentedChecklistLabel } from '../organization/checklistRelabel';
import type { Case } from '../../types/case';

/**
 * Earlier workflow stages (2026-10). Whether the organization shows an
 * earlier stage's TRUE checklist status and lets staff correct it there
 * (see OrganizationFeaturePreferences.trueEarlierStageStatus) — Manors only
 * for now; everywhere else an earlier stage reads as complete and is
 * read-only, exactly as before.
 */
export function isTrueEarlierStageStatusEnabled(organizationId: string | null | undefined): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.trueEarlierStageStatus === true;
}

const KEY = /^(\d+):(\d+)$/;

/**
 * A HISTORICAL CORRECTION (2026-10): a checklist change to a stage before
 * the case's current one — decided on the server from the case as stored,
 * never from anything the browser says. Such a change is saved and
 * attributed like any other, but it is not the moment the work happened:
 * it never schedules or moves the Expected Pickup, and its date is never
 * read as when an SLA event occurred.
 *
 * Returns the keys of the patch that belong to earlier stages (empty when
 * none do, or the case's stage cannot be resolved).
 */
export function historicalChecklistKeys(
  case_: Pick<Case, 'rawStage' | 'workflowSnapshot'>,
  checklistPatch: Record<string, unknown> | null | undefined,
): string[] {
  const keys = Object.keys(checklistPatch ?? {});
  if (keys.length === 0 || !case_.workflowSnapshot) return [];
  const current = findStageByRawStage(case_.workflowSnapshot, case_.rawStage)?.displayStage;
  if (current === undefined) return [];
  return keys.filter((key) => {
    const match = KEY.exec(key);
    return match !== null && Number(match[1]) < current;
  });
}

export function isHistoricalChecklistCorrection(
  case_: Pick<Case, 'rawStage' | 'workflowSnapshot'>,
  checklistPatch: Record<string, unknown> | null | undefined,
): boolean {
  return historicalChecklistKeys(case_, checklistPatch).length > 0;
}

/** What a historical correction changed, for the case activity (2026-10). */
export function describeChecklistCorrection(
  case_: Pick<Case, 'organizationId' | 'workflowSnapshot'>,
  checklistPatch: Record<string, unknown>,
): { description: string; changes: Array<{ key: string; stage: string; label: string; done: boolean }> } {
  const changes = Object.entries(checklistPatch).map(([key, value]) => {
    const match = KEY.exec(key);
    const displayStage = match ? Number(match[1]) : -1;
    const index = match ? Number(match[2]) : -1;
    const stage = case_.workflowSnapshot?.stages.find((s) => s.displayStage === displayStage);
    const item = stage?.checklist.items.find((i) => i.index === index);
    return {
      key,
      stage: stage?.label ?? `Stage ${displayStage}`,
      label: item ? presentedChecklistLabel(case_.organizationId, displayStage, item) : key,
      done: value === true,
    };
  });
  const parts = changes.map((c) => `${c.done ? 'checked' : 'unchecked'} "${c.label}" (${c.stage})`);
  return { description: `Earlier step corrected: ${parts.join('; ')}. Recorded as a correction — the case stays at its current stage.`, changes };
}
