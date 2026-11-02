import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { queryAllWixDataItems } from '../lib/wixDataApi';
import { mapWixActivityEventItem, type WixActivityEventItem } from '../lib/wixActivityEventMapper';
import { ACTIVITY_EVENT_TYPES, type ActivityEvent } from '../types/activityEvent';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { recordServiceChangeCompensated, recordServiceChangeJournalEntry, type ActivityContext } from './activityService';
import { listOrderOperations } from './orderOperationJournal';
import {
  getCaseOrderState,
  getOrderRevenueState,
  listCaseOrderVersions,
  listLineItemsForOrder,
  revertCommittedCaseOrderChange,
  type CommittedCaseOrderChange,
  type PreparedCaseOrderChange,
} from './pricingService';
import { caseFixtures } from './__mocks__/fixtures';
import { loadCaseRow } from './caseWriteService';
import type { Case } from '../types/case';

/**
 * Case concurrency (2026-10) — the OPERATION JOURNAL of coordinated service
 * changes (services/caseServiceChangeService.ts), and the administrator's
 * read-only report and explicit repair actions built on it.
 *
 * A service change writes two things that Wix cannot commit together: the
 * case order (a new version) and then the case (its workflow). The live
 * request compensates its own failures, but a process that DIES between
 * the two leaves a new order with the old workflow and nothing to notice
 * it. The journal is how such an operation is FOUND afterwards:
 *
 *   prepared         recorded BEFORE the first write — if it can't be
 *                    recorded, the change is refused and nothing is written
 *   order_committed  the new order version is in place
 *   case_committed   the case's workflow is in place (done)
 *   compensated      the order change was undone (done, nothing changed)
 *   failed           a failure could not be undone — needs repair
 *   resolved         an administrator closed an interrupted operation
 *
 * Entries are append-only activity events (`case.service_change.journal`,
 * category `system`, no caseId — the case's own timeline keeps its normal
 * events), so they share the activity log's durability and organization
 * scoping and need no new collection. The latest entry is the operation's
 * status; the journal is only ever a POINTER — every decision below is
 * made from the case and order as they actually are now.
 *
 * Nothing here runs on its own. The report is read-only; a repair is one
 * administrator acting on one operation of their own organization —
 * never automatic, never across organizations.
 */

export type ServiceChangeJournalStatus = 'prepared' | 'order_committed' | 'case_committed' | 'compensated' | 'failed' | 'resolved';

/** What each entry may carry. The PLAN keys come from the first
    `prepared` entry and are never overwritten by a later one (a client
    retry re-records `prepared` once the order is already in place). */
export type ServiceChangeJournalDetails = {
  fromServiceTypeCode?: string | null;
  toServiceTypeCode?: string;
  /** The template the case was on when the change was planned — what a
      resumed change must still find. */
  expectedWorkflowTemplateId?: string;
  selections?: Record<string, unknown>;
  /** The active order before the change (null: the case had none). */
  previousOrderId?: string | null;
  /** The id the new order version gets — known before it is written. */
  plannedOrderId?: string | null;
  serviceDelta?: number;
  merchandiseDelta?: number;
  /** Known only from `order_committed`: whether revenue was posted. */
  revenuePosted?: boolean;
  committedOrderId?: string | null;
  restoredOrderId?: string | null;
  reason?: string;
  resolution?: 'completed' | 'compensated' | 'closed';
  note?: string | null;
};

const PLAN_KEYS: Array<keyof ServiceChangeJournalDetails> = [
  'fromServiceTypeCode',
  'toServiceTypeCode',
  'expectedWorkflowTemplateId',
  'selections',
  'previousOrderId',
  'plannedOrderId',
  'serviceDelta',
  'merchandiseDelta',
];

const STATUS_DESCRIPTION: Record<ServiceChangeJournalStatus, string> = {
  prepared: 'Service change prepared',
  order_committed: 'Service change: new case order saved',
  case_committed: 'Service change completed',
  compensated: 'Service change undone',
  failed: 'Service change failed and needs repair',
  resolved: 'Interrupted service change resolved by an administrator',
};

/** Appends one journal entry. Throws when it can't be written — the
    caller decides whether that blocks (`prepared`) or is best-effort. */
export async function recordServiceChangeJournal(
  ctx: ActivityContext,
  entry: { serviceChangeId: string; caseId: string; status: ServiceChangeJournalStatus; details?: ServiceChangeJournalDetails },
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  await recordServiceChangeJournalEntry(
    ctx,
    {
      serviceChangeId: entry.serviceChangeId,
      caseId: entry.caseId,
      status: entry.status,
      description: `${STATUS_DESCRIPTION[entry.status]} (case ${entry.caseId}, ${entry.details?.toServiceTypeCode ?? 'service change'})`,
      details: (entry.details ?? {}) as Record<string, unknown>,
    },
    dataAdapterMode,
  );
}

export type ServiceChangeOperation = {
  serviceChangeId: string;
  organizationId: string;
  caseId: string;
  status: ServiceChangeJournalStatus;
  startedAt: string;
  updatedAt: string;
  startedBy: string | null;
  details: ServiceChangeJournalDetails;
  history: Array<{ status: ServiceChangeJournalStatus; at: string; actorIdentityId: string | null }>;
};

function parseMetadata(event: ActivityEvent): (ServiceChangeJournalDetails & { serviceChangeId?: string; caseId?: string; status?: string }) | null {
  try {
    const parsed = event.metadata ? JSON.parse(event.metadata) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Every journaled operation of ONE organization, latest status first by
    recency. Built only from that organization's own activity rows. */
export async function listServiceChangeOperations(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<ServiceChangeOperation[]> {
  let events: ActivityEvent[];
  if (dataAdapterMode === 'mock') {
    events = activityEventFixtures.filter((e) => e.organizationId === organizationId && e.eventType === ACTIVITY_EVENT_TYPES.CASE_SERVICE_CHANGE_JOURNAL);
  } else {
    const items = await queryAllWixDataItems<WixActivityEventItem>('activityEvents', {
      organizationId,
      eventType: ACTIVITY_EVENT_TYPES.CASE_SERVICE_CHANGE_JOURNAL,
    });
    events = items.map((item) => mapWixActivityEventItem(item.data)).filter((e): e is ActivityEvent => e !== null);
  }

  const byId = new Map<string, ServiceChangeOperation>();
  const sorted = events
    .filter((e) => e.organizationId === organizationId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  for (const event of sorted) {
    const meta = parseMetadata(event);
    if (!meta || typeof meta.serviceChangeId !== 'string' || typeof meta.caseId !== 'string' || typeof meta.status !== 'string') continue;
    const status = meta.status as ServiceChangeJournalStatus;
    const { serviceChangeId: id, caseId, status: _status, ...details } = meta;
    void _status;
    let op = byId.get(id);
    if (!op) {
      op = { serviceChangeId: id, organizationId, caseId, status, startedAt: event.createdAt, updatedAt: event.createdAt, startedBy: event.actorIdentityId, details: {}, history: [] };
      byId.set(id, op);
    }
    for (const [key, value] of Object.entries(details) as Array<[keyof ServiceChangeJournalDetails, unknown]>) {
      if (PLAN_KEYS.includes(key) && op.details[key] !== undefined) continue;
      (op.details as Record<string, unknown>)[key] = value;
    }
    op.status = status;
    op.updatedAt = event.createdAt;
    op.history.push({ status, at: event.createdAt, actorIdentityId: event.actorIdentityId });
  }
  return [...byId.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** How long an operation may sit at `prepared`/`order_committed` before
    the report calls it interrupted — comfortably longer than any live
    request, so an in-flight change is never offered for repair. */
export const SERVICE_CHANGE_INTERRUPTED_AFTER_MS = 5 * 60 * 1000;

export function isInterrupted(op: ServiceChangeOperation, now: Date = new Date()): boolean {
  if (op.status === 'failed') return true;
  if (op.status !== 'prepared' && op.status !== 'order_committed') return false;
  return now.getTime() - new Date(op.updatedAt).getTime() >= SERVICE_CHANGE_INTERRUPTED_AFTER_MS;
}

export type ServiceChangeInspection = {
  /** The case carries this change (its history has the serviceChangeId). */
  caseCommitted: boolean;
  /** The case's workflow template now. */
  caseWorkflowTemplateId: string | null;
  activeOrderId: string | null;
  /** Which of the operation's orders is active: its planned one (the
      order half landed), the previous one (it didn't), or neither
      (someone has edited the order since — no automatic action). */
  activeOrderIs: 'planned' | 'previous' | 'other' | 'none';
  /** What an administrator can safely do, decided from the above. */
  allowedActions: Array<'complete' | 'compensate' | 'close'>;
  summary: string;
};

async function loadCaseForInspection(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<Case | null> {
  if (dataAdapterMode === 'mock') return caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId) ?? null;
  return (await loadCaseRow(organizationId, caseId))?.case_ ?? null;
}

/** Read-only: compares the journal's plan with the case and order as they
    are now, and says which repair (if any) is safe. */
export async function inspectServiceChangeOperation(op: ServiceChangeOperation, dataAdapterMode: DataAdapterMode): Promise<ServiceChangeInspection> {
  const case_ = await loadCaseForInspection(op.organizationId, op.caseId, dataAdapterMode);
  const caseCommitted = case_?.workflowHistory?.some((entry) => entry.serviceChangeId === op.serviceChangeId) === true;
  const orderState = await getCaseOrderState(op.organizationId, op.caseId, dataAdapterMode);
  const active = orderState.active;
  const activeOrderId = active?.id ?? null;
  const { plannedOrderId = null, previousOrderId = null } = op.details;
  // A change whose plan kept the same order (only the workflow moved) has
  // no order half: its order being active means nothing of it was written.
  const orderChangePlanned = plannedOrderId !== null && plannedOrderId !== previousOrderId;
  const activeOrderIs: ServiceChangeInspection['activeOrderIs'] =
    activeOrderId === null
      ? previousOrderId === null
        ? 'previous'
        : 'none'
      : orderChangePlanned && activeOrderId === plannedOrderId
        ? 'planned'
        : activeOrderId === previousOrderId
          ? 'previous'
          : 'other';

  let allowedActions: ServiceChangeInspection['allowedActions'] = [];
  let summary: string;
  if (!case_) {
    summary = 'The case no longer exists in this organization. Close the operation after checking the order by hand.';
    allowedActions = ['close'];
  } else if (caseCommitted) {
    summary = 'The change is fully in place (the case carries it); only the journal is behind. Close it.';
    allowedActions = ['close'];
  } else if (activeOrderIs === 'previous') {
    summary = 'Nothing of this change was kept: the order and the workflow are both as before. Complete it now, or close it.';
    allowedActions = ['complete', 'close'];
  } else if (activeOrderIs === 'planned') {
    summary = 'The new order is in place but the case is still on its previous workflow — they disagree. Complete the change, or compensate (undo the order).';
    allowedActions = ['complete', 'compensate'];
  } else {
    summary = 'The case order has been changed by something else since. No automatic repair is safe — review the order and case by hand, then close this.';
    allowedActions = ['close'];
  }
  if (orderState.interruption) {
    // Phase 5A.2: the case's order is held by an unfinished order change
    // (services/orderOperationJournal.ts). Nothing here may move the order
    // until THAT is repaired — then this operation can be inspected again.
    allowedActions = [];
    summary = `The case order has an unfinished change (${orderState.interruption.pendingOrderId}). Repair it first under the interrupted case order changes (GET /api/cases/order-operations), then come back to this service change.`;
  }
  if (allowedActions.includes('complete') && case_ && op.details.expectedWorkflowTemplateId && case_.workflowTemplateId !== op.details.expectedWorkflowTemplateId) {
    // The workflow moved on since: completing would replan from a case the
    // change was not planned for.
    allowedActions = allowedActions.filter((action) => action !== 'complete');
    summary += ' (Its workflow has changed since, so it cannot be completed automatically.)';
  }
  return { caseCommitted, caseWorkflowTemplateId: case_?.workflowTemplateId ?? null, activeOrderId, activeOrderIs, allowedActions, summary };
}

export type ServiceChangeRepairOutcome = { status: number; body: Record<string, unknown> };

/**
 * Undo the order half of an interrupted change — reconstructed from the
 * journal and the stored orders, then handed to the SAME
 * revertCommittedCaseOrderChange the live request uses (appends a
 * restoring version; deletes nothing). Refused when revenue posting is
 * unknown: reversing revenue that was never posted would corrupt the
 * ledger just as surely as leaving posted revenue in place.
 */
export async function compensateServiceChangeOperation(
  op: ServiceChangeOperation,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<ServiceChangeRepairOutcome> {
  const { plannedOrderId, previousOrderId = null, serviceDelta = 0, merchandiseDelta = 0 } = op.details;
  if (!plannedOrderId || plannedOrderId === previousOrderId) return { status: 409, body: { error: 'This operation has no recorded order change to undo.' } };
  // Phase 5A.2: when the journal never recorded it, the ledger can answer —
  // but only for an order change made since revenue entries carry their
  // operation's reference (it has an order-operation journal of its own).
  // Older ones stay "unknown" rather than misread as "not posted".
  let revenuePosted = op.details.revenuePosted;
  if (revenuePosted === undefined && (serviceDelta !== 0 || merchandiseDelta !== 0)) {
    const orderOperation = (await listOrderOperations(op.organizationId, dataAdapterMode).catch(() => [])).find((o) => o.operationId === plannedOrderId);
    if (orderOperation?.details.revenueReference) {
      const state = await getOrderRevenueState(
        { organizationId: op.organizationId, caseId: op.caseId, revenueReference: orderOperation.details.revenueReference, serviceDelta, merchandiseDelta },
        dataAdapterMode,
      ).catch(() => null);
      revenuePosted = state === 'posted' ? true : state === 'not_posted' ? false : undefined;
    }
  }
  const revenueKnown = revenuePosted !== undefined || (serviceDelta === 0 && merchandiseDelta === 0);
  if (!revenueKnown) {
    return {
      status: 409,
      body: {
        error: 'Whether revenue was posted for this change is not recorded, so it cannot be undone automatically. Review the general ledger and the case order by hand.',
        reason: 'revenue_unknown',
      },
    };
  }
  const versions = await listCaseOrderVersions(op.organizationId, op.caseId, dataAdapterMode);
  const committedOrder = versions.find((o) => o.id === plannedOrderId);
  const previousOrder = previousOrderId ? versions.find((o) => o.id === previousOrderId) ?? null : null;
  if (!committedOrder || (previousOrderId && !previousOrder)) {
    return { status: 409, body: { error: 'The orders this change involved can no longer be found.' } };
  }
  const [committedLines, previousLines] = await Promise.all([
    listLineItemsForOrder(op.organizationId, committedOrder.id, dataAdapterMode),
    previousOrder ? listLineItemsForOrder(op.organizationId, previousOrder.id, dataAdapterMode) : Promise.resolve([]),
  ]);
  const prepared: Extract<PreparedCaseOrderChange, { kind: 'change' }> = {
    kind: 'change',
    organizationId: op.organizationId,
    caseId: op.caseId,
    performedBy: ctx.actorIdentityId ?? 'system',
    nowIso: new Date().toISOString(),
    current: previousOrder,
    currentLineItems: previousLines,
    newOrder: committedOrder,
    newLineItems: committedLines,
    auditEntries: [],
    diffEntries: [],
    serviceDelta,
    merchandiseDelta,
  };
  const committed: CommittedCaseOrderChange = {
    prepared,
    order: committedOrder,
    lineItems: committedLines,
    auditEntries: [],
    revenuePosted: revenuePosted ?? false,
  };
  const reason = 'an administrator undid an interrupted service change';
  const restored = await revertCommittedCaseOrderChange(committed, { idFactory: () => crypto.randomUUID(), reason, journalContext: ctx }, dataAdapterMode);
  const details = {
    serviceChangeId: op.serviceChangeId,
    failedStep: 'case' as const,
    reason,
    fromServiceTypeCode: op.details.fromServiceTypeCode ?? null,
    toServiceTypeCode: op.details.toServiceTypeCode ?? '',
    committedOrderId: committedOrder.id,
    restoredOrderId: restored?.id ?? null,
  };
  try {
    await recordServiceChangeCompensated(ctx, op.caseId, details, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record case.service_change.compensated activity event:', error instanceof Error ? error.message : error);
  }
  return { status: 200, body: { compensated: true, restoredOrderId: restored?.id ?? null } };
}
