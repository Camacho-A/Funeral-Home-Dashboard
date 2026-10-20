import type { Case, CaseUpdate, ChecklistAutomationEntry, ChecklistAutomationSource } from '../../types/case';
import type { CaseWorkflowSnapshot } from '../../types/workflowTemplate';
import { findPaymentConfirmationChecklistIndex } from '../cases/paymentChecklist';
import { checklistItemKey, readChecklistValue } from './checklistItemKey';
import { getRegisteredOrganizationProfile } from '../organization/organizationProfiles';

/**
 * Automatic checklist completion (2026-10).
 *
 * Staff should not have to do something in SOLIS and then tick a box
 * saying they did it. For the few checklist items SOLIS can VERIFY from
 * its own records, the event that proves the work completes the item:
 *
 *   "Payment collected"              the case's balance is paid in full
 *                                    (services/paymentWorkflow.ts)
 *   "Jotform application completed"  the case's Arrangement Form submission
 *                                    is received and linked
 *                                    (services/automaticChecklistCompletion.ts)
 *
 * Everything else stays manual: SOLIS has no evidence for it (a fax sent to
 * the crematory, an EDRS entry, a physical label), or it is already derived
 * from its own record ("Family picked up ashes" from the release record,
 * the First Call items from the case's information).
 *
 * This module only DECIDES. It is pure, so every caller makes the same
 * decision from the case as it is at write time:
 *
 *   - never on an archived case;
 *   - never for an item that is already done (no change, no duplicate
 *     audit event, however often the event is retried);
 *   - never over a staff decision: once staff change an automatable item,
 *     automation leaves it alone.
 */

/** Manors only (organization profile); every other organization keeps its
    existing behaviour exactly. */
export function isChecklistAutomationEnabled(organizationId: string | null | undefined): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.automaticChecklistCompletion;
}

export type ChecklistItemLocation = { displayStage: number; index: number };

/** The "Jotform application completed" item: the one item a template ties
    to an external form (`externalFormIntegrationId`), found in the case's
    own snapshot rather than at a fixed position. */
export function findArrangementFormChecklistItem(snapshot: CaseWorkflowSnapshot | null): ChecklistItemLocation | null {
  if (!snapshot) return null;
  for (const stage of snapshot.stages) {
    const item = stage.checklist.items.find((candidate) => Boolean(candidate.externalFormIntegrationId));
    if (item) return { displayStage: stage.displayStage, index: item.index };
  }
  return null;
}

/** Where each automatable item sits in this case's own snapshot. */
export function automatableChecklistItems(case_: Pick<Case, 'workflowSnapshot'>): Map<string, ChecklistAutomationSource> {
  const items = new Map<string, ChecklistAutomationSource>();
  const payment = findPaymentConfirmationChecklistIndex(case_.workflowSnapshot);
  if (payment) items.set(checklistItemKey(payment.displayStage, payment.index), 'payment_received_in_full');
  const form = findArrangementFormChecklistItem(case_.workflowSnapshot);
  if (form) items.set(checklistItemKey(form.displayStage, form.index), 'arrangement_form_received');
  return items;
}

/**
 * The patch that completes `location` automatically, or null when it must
 * not be applied (see the rules above). The checklist tick and its
 * provenance are written together, in one patch.
 */
export function automaticChecklistCompletion(
  case_: Pick<Case, 'isDeleted' | 'checklistState' | 'checklistAutomation'>,
  location: ChecklistItemLocation,
  source: ChecklistAutomationSource,
  now: string,
): Pick<CaseUpdate, 'checklistState' | 'checklistAutomation'> | null {
  if (case_.isDeleted) return null;
  if (readChecklistValue(case_.checklistState, location.displayStage, location.index) === true) return null;
  const key = checklistItemKey(location.displayStage, location.index);
  if (case_.checklistAutomation?.[key]?.by === 'staff') return null;
  return {
    checklistState: { [key]: true },
    checklistAutomation: { [key]: { by: 'automatic', source, at: now } },
  };
}

/**
 * A staff checklist edit: records a staff decision for every automatable
 * item the edit actually changes, so automation never overrides it later
 * (an unticked "Payment collected" stays unticked when a later payment
 * succeeds). Returns null when the edit touches no automatable item.
 */
export function staffChecklistAutomationUpdate(
  current: Pick<Case, 'workflowSnapshot' | 'checklistState'>,
  patchChecklistState: Record<string, boolean>,
  now: string,
): Record<string, ChecklistAutomationEntry> | null {
  const automatable = automatableChecklistItems(current);
  const entries: Record<string, ChecklistAutomationEntry> = {};
  for (const [key, value] of Object.entries(patchChecklistState)) {
    if (!automatable.has(key) || current.checklistState[key] === value) continue;
    entries[key] = { by: 'staff', at: now };
  }
  return Object.keys(entries).length > 0 ? entries : null;
}

/** Whether a done item shows "Completed automatically". */
export function isCompletedAutomatically(case_: Pick<Case, 'checklistAutomation'>, displayStage: number, index: number): boolean {
  return case_.checklistAutomation?.[checklistItemKey(displayStage, index)]?.by === 'automatic';
}

export const CHECKLIST_AUTOMATION_SOURCE_LABEL: Record<ChecklistAutomationSource, string> = {
  payment_received_in_full: 'payment received in full',
  arrangement_form_received: 'Arrangement Form received',
};
