import type { DataAdapterMode } from '../lib/env';
import { queryAllWixDataItems } from '../lib/wixDataApi';
import { mapWixActivityEventItem, type WixActivityEventItem } from '../lib/wixActivityEventMapper';
import { ACTIVITY_EVENT_TYPES, type ActivityEvent } from '../types/activityEvent';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { recordCaseOrderOperationJournalEntry, type ActivityContext } from './activityService';
import type { CaseOrderAuditEntry } from '../types/caseOrderAudit';

/**
 * Interrupted order edits (2026-10, Phase 5A.2) — the OPERATION JOURNAL of
 * case order changes. Every change to a case's order (creation, edit,
 * merchandise add/return, the order half of a service change, and the
 * restoring version a compensation appends) writes several rows that Wix
 * cannot commit together (docs/ORDER_VERSIONING.md):
 *
 *   line items → pending version → previous version superseded →
 *   pending version activated → audit entries → revenue recognition
 *
 * The live request undoes its own failures, but a process that DIES part
 * way leaves rows nobody is coming back for. The journal is how such an
 * operation is FOUND afterwards:
 *
 *   prepared    recorded BEFORE the first row write — if it can't be, the
 *               change is refused and nothing is written
 *   activated   the new version is the case's order
 *   completed   audit entries and revenue are written too (done)
 *   abandoned   nothing of the change took effect (done, nothing changed)
 *   compensated the change was undone by a restoring version (done)
 *   failed      a failure could not be undone — needs repair
 *   resolved    an administrator repaired or closed an interrupted one
 *
 * Entries are append-only activity events (`case.order.operation.journal`,
 * category `system`, no caseId), so they share the activity log's
 * durability and organization scoping and need no new collection. The
 * operation id is the planned version's id, known before anything is
 * written. The journal is only ever a POINTER: every repair decision is
 * made from the order rows and the ledger as they are now
 * (services/orderOperationRepair.ts). This module deliberately imports
 * nothing from pricingService, which records through it.
 */

export type OrderOperationStatus = 'prepared' | 'activated' | 'completed' | 'abandoned' | 'compensated' | 'failed' | 'resolved';

export type OrderOperationKind = 'create' | 'edit' | 'restore' | 'withdraw';

/** The plan, from the first `prepared` entry — later entries never
    overwrite it. */
export type OrderOperationPlan = {
  kind?: OrderOperationKind;
  /** The active version the change replaces (null: the case had none). */
  previousOrderId?: string | null;
  previousVersion?: number | null;
  /** The version the change creates — also the operation id. Null only
      for `withdraw` (a first order taken back, nothing replaces it). */
  plannedOrderId?: string | null;
  plannedVersion?: number | null;
  plannedTotal?: number | null;
  serviceDelta?: number;
  merchandiseDelta?: number;
  /** `sourceReferenceId` of the revenue-recognition entry this operation
      posts — how a repair tells from the ledger whether it was posted. */
  revenueReference?: string | null;
  /** The audit entries the change appends, with their ids fixed in
      advance, so a repair can write exactly the missing ones. */
  auditEntries?: CaseOrderAuditEntry[];
};

export type OrderOperationDetails = OrderOperationPlan & {
  revenuePosted?: boolean;
  reason?: string;
  resolution?: 'completed' | 'rolled_back' | 'closed';
  note?: string | null;
};

const PLAN_KEYS: Array<keyof OrderOperationPlan> = [
  'kind',
  'previousOrderId',
  'previousVersion',
  'plannedOrderId',
  'plannedVersion',
  'plannedTotal',
  'serviceDelta',
  'merchandiseDelta',
  'revenueReference',
  'auditEntries',
];

const STATUS_DESCRIPTION: Record<OrderOperationStatus, string> = {
  prepared: 'Case order change prepared',
  activated: 'Case order change: new version in effect',
  completed: 'Case order change completed',
  abandoned: 'Case order change not applied',
  compensated: 'Case order change undone',
  failed: 'Case order change failed and needs repair',
  resolved: 'Interrupted case order change resolved by an administrator',
};

/** The revenue-recognition reference of the operation that creates (or
    withdraws) `orderId` — written as the entry's `sourceReferenceId`. */
export function orderRevenueReference(kind: OrderOperationKind, orderId: string): string {
  return kind === 'withdraw' ? `case-order-withdraw:${orderId}` : `case-order-revenue:${orderId}`;
}

/** Appends one journal entry. Throws when it can't be written. */
export async function recordOrderOperationJournal(
  ctx: ActivityContext,
  entry: { operationId: string; caseId: string; status: OrderOperationStatus; details?: OrderOperationDetails },
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  await recordCaseOrderOperationJournalEntry(
    ctx,
    {
      operationId: entry.operationId,
      caseId: entry.caseId,
      status: entry.status,
      description: `${STATUS_DESCRIPTION[entry.status]} (case ${entry.caseId})`,
      details: (entry.details ?? {}) as Record<string, unknown>,
    },
    dataAdapterMode,
  );
}

/** Best-effort variant for every entry after `prepared`: the rows are the
    truth, the journal only points at them. A lost entry is logged. */
export async function recordOrderOperationJournalBestEffort(
  ctx: ActivityContext,
  entry: { operationId: string; caseId: string; status: OrderOperationStatus; details?: OrderOperationDetails },
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  try {
    await recordOrderOperationJournal(ctx, entry, dataAdapterMode);
  } catch (error) {
    console.error(
      `Failed to record case order operation journal entry (${entry.status}):`,
      error instanceof Error ? error.message : error,
      JSON.stringify({ organizationId: ctx.organizationId, caseId: entry.caseId, operationId: entry.operationId }),
    );
  }
}

export type OrderOperation = {
  operationId: string;
  organizationId: string;
  caseId: string;
  status: OrderOperationStatus;
  startedAt: string;
  updatedAt: string;
  startedBy: string | null;
  details: OrderOperationDetails;
  history: Array<{ status: OrderOperationStatus; at: string; actorIdentityId: string | null }>;
};

function parseMetadata(event: ActivityEvent): (OrderOperationDetails & { operationId?: string; caseId?: string; status?: string }) | null {
  try {
    const parsed = event.metadata ? JSON.parse(event.metadata) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Every journaled order operation of ONE organization, most recently
    updated first. Built only from that organization's own activity rows. */
export async function listOrderOperations(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<OrderOperation[]> {
  let events: ActivityEvent[];
  if (dataAdapterMode === 'mock') {
    events = activityEventFixtures.filter((e) => e.organizationId === organizationId && e.eventType === ACTIVITY_EVENT_TYPES.CASE_ORDER_OPERATION_JOURNAL);
  } else {
    const items = await queryAllWixDataItems<WixActivityEventItem>('activityEvents', {
      organizationId,
      eventType: ACTIVITY_EVENT_TYPES.CASE_ORDER_OPERATION_JOURNAL,
    });
    events = items.map((item) => mapWixActivityEventItem(item.data)).filter((e): e is ActivityEvent => e !== null);
  }

  const byId = new Map<string, OrderOperation>();
  const sorted = events
    .filter((e) => e.organizationId === organizationId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  for (const event of sorted) {
    const meta = parseMetadata(event);
    if (!meta || typeof meta.operationId !== 'string' || typeof meta.caseId !== 'string' || typeof meta.status !== 'string') continue;
    const status = meta.status as OrderOperationStatus;
    const { operationId: id, caseId, status: _status, ...details } = meta;
    void _status;
    let op = byId.get(id);
    if (!op) {
      op = { operationId: id, organizationId, caseId, status, startedAt: event.createdAt, updatedAt: event.createdAt, startedBy: event.actorIdentityId, details: {}, history: [] };
      byId.set(id, op);
    }
    for (const [key, value] of Object.entries(details) as Array<[keyof OrderOperationDetails, unknown]>) {
      if (PLAN_KEYS.includes(key as keyof OrderOperationPlan) && op.details[key] !== undefined) continue;
      (op.details as Record<string, unknown>)[key] = value;
    }
    op.status = status;
    op.updatedAt = event.createdAt;
    op.history.push({ status, at: event.createdAt, actorIdentityId: event.actorIdentityId });
  }
  return [...byId.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** How long an operation may sit at `prepared`/`activated` before the
    report calls it interrupted — far longer than any live request, so an
    in-flight change is never offered for repair. */
export const ORDER_OPERATION_INTERRUPTED_AFTER_MS = 5 * 60 * 1000;

export function isOrderOperationInterrupted(op: OrderOperation, now: Date = new Date()): boolean {
  if (op.status === 'failed') return true;
  if (op.status !== 'prepared' && op.status !== 'activated') return false;
  return now.getTime() - new Date(op.updatedAt).getTime() >= ORDER_OPERATION_INTERRUPTED_AFTER_MS;
}
