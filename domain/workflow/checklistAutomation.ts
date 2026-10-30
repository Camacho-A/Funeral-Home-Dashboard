import type { Case, CaseUpdate, ChecklistCompletionRecord, ChecklistCompletionSource } from '../../types/case';
import { SOLIS_AUTOMATION_ID } from '../../types/case';
import type { CaseWorkflowSnapshot } from '../../types/workflowTemplate';
import { findPaymentConfirmationChecklistIndex } from '../cases/paymentChecklist';
import { checklistItemKey, readChecklistValue } from './checklistItemKey';
import { getRegisteredOrganizationProfile } from '../organization/organizationProfiles';

/**
 * Automatic checklist completion and completion attribution (2026-10).
 *
 * Staff should not have to do something in SOLIS and then tick a box
 * saying they did it. For the checklist items SOLIS can VERIFY from its own
 * records, the event that proves the work completes the item:
 *
 *   "Payment collected"              the balance is paid in full
 *                                    (services/paymentWorkflow.ts)
 *   "Jotform application completed"  the Arrangement Form is received and
 *                                    linked (services/automaticChecklistCompletion.ts)
 *   SLA-mapped items                 the workflow event recorded by staff on
 *                                    the SLA panel (domain/sla/slaMilestones.ts)
 *   "Permit sent to crematory" and   the Crematory Package was sent through
 *   "Authorization of release sent   SOLIS and Outlook accepted it
 *   to crematory"                    (services/crematory/crematorySentChecklist.ts)
 *
 * Every decision about an item, automatic or by staff, leaves a
 * `ChecklistCompletionRecord`, so the checklist can say WHY an item is done.
 *
 * This module only DECIDES. It is pure, so every caller makes the same
 * decision from the case as it is at write time:
 *
 *   - never on an archived case;
 *   - never for an item already done (a retried or duplicate event changes
 *     nothing and records nothing — the original source is preserved);
 *   - never over a staff decision: once staff change an item, automation
 *     leaves it alone.
 */

/** Manors only (organization profile); every other organization keeps its
    existing behaviour exactly. */
export function isChecklistAutomationEnabled(organizationId: string | null | undefined): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.automaticChecklistCompletion;
}

export type ChecklistItemLocation = { displayStage: number; index: number };

/** What triggered an automatic completion. */
export type AutomaticTrigger = { source: ChecklistCompletionSource; eventType: string; eventId: string | null };

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

/** Where the payment and arrangement-form items sit in this case's snapshot. */
export function automatableChecklistItems(case_: Pick<Case, 'workflowSnapshot'>): Map<string, 'payment' | 'arrangement_form'> {
  const items = new Map<string, 'payment' | 'arrangement_form'>();
  const payment = findPaymentConfirmationChecklistIndex(case_.workflowSnapshot);
  if (payment) items.set(checklistItemKey(payment.displayStage, payment.index), 'payment');
  const form = findArrangementFormChecklistItem(case_.workflowSnapshot);
  if (form) items.set(checklistItemKey(form.displayStage, form.index), 'arrangement_form');
  return items;
}

/**
 * The patch that completes `location` automatically, or null when it must
 * not be applied (see the rules above). The tick and its record are
 * written together, in one patch.
 */
export function automaticChecklistCompletion(
  case_: Pick<Case, 'isDeleted' | 'checklistState' | 'checklistCompletions'>,
  location: ChecklistItemLocation,
  trigger: AutomaticTrigger,
  now: string,
  /** Send to Crematory (2026-10): `actorId` attributes the completion to the
      staff member whose action proved it (default: SOLIS Automation), and
      `overrideEarlierReopen` lets an event that happens AFTER a staff
      member reopened the item complete it again — the send is newer
      evidence than the earlier reopen. A staff tick is never touched. */
  options: { actorId?: string | null; overrideEarlierReopen?: boolean } = {},
): Pick<CaseUpdate, 'checklistState' | 'checklistCompletions'> | null {
  if (case_.isDeleted) return null;
  if (readChecklistValue(case_.checklistState, location.displayStage, location.index) === true) return null;
  const key = checklistItemKey(location.displayStage, location.index);
  const previous = case_.checklistCompletions?.[key];
  if (previous?.method === 'manual') {
    const reopenedEarlier = previous.done === false && Date.parse(previous.at) <= Date.parse(now);
    if (!(options.overrideEarlierReopen && reopenedEarlier)) return null;
  }
  return {
    checklistState: { [key]: true },
    checklistCompletions: {
      [key]: {
        done: true,
        method: 'automatic',
        source: trigger.source,
        eventType: trigger.eventType,
        eventId: trigger.eventId,
        at: now,
        actorId: options.actorId ?? SOLIS_AUTOMATION_ID,
      },
    },
  };
}

/**
 * A staff checklist edit: one manual record for every item the edit
 * actually changes (completed or reopened), attributed to the staff member.
 * Returns null when nothing changes.
 */
export function staffChecklistCompletionUpdate(
  current: Pick<Case, 'checklistState'>,
  patchChecklistState: Record<string, boolean>,
  actorId: string | null,
  now: string,
  /** Historical corrections (2026-10): the keys, on stages the case had
      already moved beyond, whose records say so. */
  options: { historicalKeys?: readonly string[] } = {},
): Record<string, ChecklistCompletionRecord> | null {
  const records: Record<string, ChecklistCompletionRecord> = {};
  for (const [key, value] of Object.entries(patchChecklistState)) {
    if ((current.checklistState[key] === true) === (value === true)) continue;
    records[key] = {
      done: value === true,
      method: 'manual',
      source: 'staff_confirmation',
      eventType: 'staff.checklist_toggle',
      eventId: null,
      at: now,
      actorId,
      ...(options.historicalKeys?.includes(key) ? { historical: true } : {}),
    };
  }
  return Object.keys(records).length > 0 ? records : null;
}

/**
 * What the checklist says about a done item.
 *
 *   automatic    SOLIS completed it from a recorded event.
 *   manual       a staff member completed it.
 *   derived      done because the information it asks for exists on the
 *                case (First Call fields, certifier, the release record) —
 *                there is no separate act of completing it.
 *   unavailable  done, but no record says how (decided before records
 *                existed). Nothing is inferred.
 */
export type ChecklistCompletionInfo =
  | { kind: 'automatic' | 'manual'; record: ChecklistCompletionRecord }
  | { kind: 'derived' }
  | { kind: 'unavailable' };

export function checklistCompletionInfo(
  case_: Pick<Case, 'checklistCompletions'>,
  displayStage: number,
  index: number,
  derived: boolean,
): ChecklistCompletionInfo {
  if (derived) return { kind: 'derived' };
  const record = case_.checklistCompletions?.[checklistItemKey(displayStage, index)];
  if (record && record.done) return { kind: record.method, record };
  return { kind: 'unavailable' };
}

/** When the item was last completed, from its record (null when unknown). */
export function checklistCompletedAt(case_: Pick<Case, 'checklistCompletions'>, displayStage: number, index: number): string | null {
  const record = case_.checklistCompletions?.[checklistItemKey(displayStage, index)];
  return record && record.done ? record.at : null;
}

export const CHECKLIST_COMPLETION_SOURCE_LABEL: Record<ChecklistCompletionSource, string> = {
  payment_confirmed: 'Payment confirmed',
  document_generated: 'Document generated',
  verified_document_received: 'Verified document received',
  workflow_event: 'Workflow event completed',
  staff_confirmation: 'Staff confirmation',
};

/** Plain-language reason for an automatic or manual record. */
export function describeCompletionEvent(record: ChecklistCompletionRecord): string {
  switch (record.eventType) {
    case 'payment.paid_in_full':
      return 'A verified payment brought the balance to $0.';
    case 'external_form.arrangement_received':
      return 'The Arrangement Form submission was received and linked to this case.';
    case 'sla.event_recorded':
      return 'The matching workflow event was recorded in the case’s SLA details.';
    case 'crematory.package_submitted':
      return 'The Crematory Package was sent to the crematory through SOLIS (accepted by Outlook).';
    case 'staff.checklist_toggle':
      return record.done ? 'A staff member checked this item.' : 'A staff member reopened this item.';
    default:
      return CHECKLIST_COMPLETION_SOURCE_LABEL[record.source];
  }
}
