import type { Case } from '../../types/case';
import { checklistItemsForEvent } from '../sla/slaMilestones';
import { checklistItemKey } from '../workflow/checklistItemKey';
import { sendToCrematoryConfig } from './crematorySettings';
import { releaseGateRefusal } from '../servicePreparation/releaseForCremation';

/**
 * Send to Crematory — Workflow 3's two "sent to crematory" items (2026-10).
 *
 * "Permit sent to crematory" and "Authorization of release sent to
 * crematory" record that the crematory has the paperwork. SOLIS completes
 * them itself when Outlook accepts a send (services/crematory/
 * crematorySentChecklist.ts); by hand, only an administrator — or a role
 * the organization lists in `sentStepsByHandRoleKeys` (Gus: Administrator,
 * Manager, Funeral Director, 2026-11) — may check or uncheck them. Everyone
 * else sees them read-only. Every other checklist item keeps its
 * permissions. Checking one is still refused by the release gate on the
 * server (crematorySentChecklistReleaseRefusal).
 *
 * The items are found by their stable keys (stage 3, items 0 and 1),
 * guarded by the labels in the case's own snapshot — the same mapping the
 * SLA panel and the automatic completion use. Only for an organization with
 * Send to Crematory (Manors); a case whose template lacks both items has
 * none, so nothing is restricted.
 */
export const CREMATORY_SENT_ITEMS_ADMIN_ONLY_MESSAGE =
  'Only an administrator can change "Permit sent to crematory" or "Authorization of release sent to crematory". SOLIS checks them automatically when the crematory email is sent.';

/** Whether this person may change the two "sent to crematory" steps by hand. */
export function maySetCrematorySentStepsByHand(organizationId: string, roleKey: string | null | undefined, isAdministrator: boolean): boolean {
  if (isAdministrator) return true;
  return Boolean(roleKey) && (sendToCrematoryConfig(organizationId)?.sentStepsByHandRoleKeys ?? []).includes(roleKey!);
}

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

/**
 * Whether the crematory has (or may have) the paperwork already (2026-11):
 * a SOLIS send that went out or may have, one being sent, a send recorded
 * as made outside SOLIS, or the "sent to crematory" steps checked. Used to
 * warn that a release hold does NOT recall anything — the crematory must be
 * contacted.
 */
export function crematoryPaperworkMayHaveBeenSent(case_: Pick<Case, 'organizationId' | 'workflowSnapshot' | 'checklistState' | 'crematory'>): boolean {
  const record = case_.crematory;
  const status = record?.lastSubmission?.status;
  if (status === 'submitted' || status === 'uncertain' || record?.pendingSubmission) return true;
  if (record?.previousSend?.decision === 'sent_outside_solis') return true;
  const keys = crematorySentChecklistKeys(case_);
  return keys.length > 0 && keys.some((key) => case_.checklistState?.[key] === true);
}

/**
 * Release gate (2026-11): checking a "sent to crematory" step records that
 * the crematory has the paperwork, so it is refused while the case must be
 * released and is not (or is on hold). Unchecking is always allowed. Null
 * when allowed — including whenever the organization does not enforce the
 * gate (everyone today).
 */
export function crematorySentChecklistReleaseRefusal(
  case_: Pick<Case, 'organizationId' | 'workflowSnapshot' | 'checklistState' | 'servicePreparation'>,
  patch: Readonly<Record<string, boolean>> | null | undefined,
): string | null {
  if (!adminOnlyChecklistChanges(case_, patch).some((key) => patch![key] === true)) return null;
  return releaseGateRefusal(case_, sendToCrematoryConfig(case_.organizationId)?.requireReleaseAfterService === true);
}
