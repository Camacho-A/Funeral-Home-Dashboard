import type { Case } from '../../types/case';
import { checklistItemsForEvent } from '../sla/slaMilestones';
import { checklistItemKey } from '../workflow/checklistItemKey';
import { sendToCrematoryConfig } from './crematorySettings';

/**
 * Send to Crematory — Workflow 3's two "sent to crematory" items (2026-10).
 *
 * "Permit sent to crematory" and "Authorization of release sent to
 * crematory" record that the crematory has the paperwork. SOLIS completes
 * them itself when Outlook accepts a send (services/crematory/
 * crematorySentChecklist.ts); by hand, only an administrator may check or
 * uncheck them. Everyone else sees them read-only. Every other checklist
 * item keeps its permissions.
 *
 * The items are found by their stable keys (stage 3, items 0 and 1),
 * guarded by the labels in the case's own snapshot — the same mapping the
 * SLA panel and the automatic completion use. Only for an organization with
 * Send to Crematory (Manors); a case whose template lacks both items has
 * none, so nothing is restricted.
 */
export const CREMATORY_SENT_ITEMS_ADMIN_ONLY_MESSAGE =
  'Only an administrator can change "Permit sent to crematory" or "Authorization of release sent to crematory". SOLIS checks them automatically when the crematory email is sent.';

export function crematorySentChecklistKeys(case_: Pick<Case, 'organizationId' | 'workflowSnapshot'>): string[] {
  if (!sendToCrematoryConfig(case_.organizationId)) return [];
  return checklistItemsForEvent(case_, 'sent_to_crematory').map((item) => checklistItemKey(item.displayStage, item.index));
}

/** The admin-only keys this checklist patch would actually change. */
export function adminOnlyChecklistChanges(
  case_: Pick<Case, 'organizationId' | 'workflowSnapshot' | 'checklistState'>,
  patch: Readonly<Record<string, boolean>> | null | undefined,
): string[] {
  if (!patch) return [];
  const keys = crematorySentChecklistKeys(case_);
  return keys.filter((key) => key in patch && patch[key] !== (case_.checklistState?.[key] === true));
}
