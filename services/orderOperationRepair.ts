import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import type { CaseOrder, CaseOrderStatus } from '../types/caseOrder';
import type { ActivityContext } from './activityService';
import {
  claimCaseOrderForRepair,
  getPaidAmountForCase,
  getOrderRevenueState,
  listAllCaseOrderRows,
  listAuditEntriesForCase,
  persistMissingAuditEntries,
  pickActiveCaseOrder,
  postOrderRevenueOnce,
  refreshBalanceForCase,
  swapCaseOrderStatusForRepair,
  withdrawPendingOrderChange,
} from './pricingService';
import { orderRevenueReference, recordOrderOperationJournal, recordOrderOperationJournalBestEffort, type OrderOperation } from './orderOperationJournal';
import { markCasePaidIfVerified } from './paymentWorkflow';

/**
 * Interrupted order edits (2026-10, Phase 5A.2) — an administrator's
 * read-only inspection of ONE journaled order operation and the explicit
 * repairs built on it (GET/POST /api/cases/order-operations).
 *
 * Every decision is made from the order rows and the ledger AS THEY ARE
 * NOW — the journal only says what the operation planned. Nothing runs on
 * its own; nothing crosses organizations (every read is scoped to the
 * operation's organization, which is the caller's own); every repair is
 * one administrator acting on one operation, journaled (`resolved`, with
 * the actor) and refused whenever the current state makes it unsafe:
 *
 *  - complete  finish the change: activate the planned version (superseding
 *              the previous one if that never happened), write its missing
 *              audit entries, post its revenue ONLY if the ledger shows it
 *              isn't posted (postOrderRevenueOnce), refresh the balance.
 *  - roll_back take back a change that never took effect: previous version
 *              active again, the pending one `withdrawn`. Only while the
 *              planned version is still pending — no revenue exists then.
 *  - close     nothing (more) to do, or handled by hand — with a note.
 *
 * A repair that changes rows first claims the row (claimCaseOrderForRepair),
 * so two administrators can never both post the same revenue.
 */

export type OrderOperationRepairAction = 'complete' | 'roll_back' | 'close';

export type OrderOperationInspection = {
  plannedStatus: CaseOrderStatus | 'missing' | null;
  previousStatus: CaseOrderStatus | 'missing' | null;
  /** The previous version was superseded by THIS operation's version. */
  previousSupersededByPlanned: boolean;
  activeOrderId: string | null;
  /** An active version that is neither this operation's nor the one it
      replaced — someone changed the order since; no automatic repair. */
  otherActiveOrderId: string | null;
  /** `partial`: a ledger entry for this change was cut off part way —
      never repaired automatically. */
  revenue: 'posted' | 'not_posted' | 'not_needed' | 'partial' | 'unknown';
  missingAuditEntries: number | null;
  allowedActions: OrderOperationRepairAction[];
  summary: string;
};

export type OrderOperationRepairOutcome = { status: number; body: Record<string, unknown> };

function statusOf(rows: CaseOrder[], id: string | null | undefined): CaseOrderStatus | 'missing' | null {
  if (!id) return null;
  return rows.find((o) => o.id === id)?.status ?? 'missing';
}

export async function inspectOrderOperation(op: OrderOperation, dataAdapterMode: DataAdapterMode): Promise<OrderOperationInspection> {
  const { organizationId, caseId } = op;
  const d = op.details;
  const kind = d.kind ?? 'edit';
  const plannedOrderId = d.plannedOrderId ?? null;
  const previousOrderId = d.previousOrderId ?? null;

  const rows = await listAllCaseOrderRows(organizationId, caseId, dataAdapterMode);
  const plannedStatus = statusOf(rows, plannedOrderId);
  const previousStatus = statusOf(rows, previousOrderId);
  const previous = previousOrderId ? rows.find((o) => o.id === previousOrderId) ?? null : null;
  const previousSupersededByPlanned = Boolean(previous && plannedOrderId && previous.status === 'superseded' && previous.supersededByOrderId === plannedOrderId);
  const active = pickActiveCaseOrder(rows);
  const otherActiveOrderId = active && active.id !== plannedOrderId && active.id !== previousOrderId ? active.id : null;

  const serviceDelta = d.serviceDelta ?? 0;
  const merchandiseDelta = d.merchandiseDelta ?? 0;
  const revenueReference = d.revenueReference ?? (plannedOrderId ? orderRevenueReference(kind, plannedOrderId) : previousOrderId ? orderRevenueReference('withdraw', previousOrderId) : null);
  let revenue: OrderOperationInspection['revenue'];
  if (serviceDelta === 0 && merchandiseDelta === 0) revenue = 'not_needed';
  else if (!revenueReference) revenue = 'unknown';
  else revenue = await getOrderRevenueState({ organizationId, caseId, revenueReference, serviceDelta, merchandiseDelta }, dataAdapterMode).catch(() => 'unknown' as const);

  const planned = d.auditEntries ?? [];
  const missingAuditEntries = planned.length === 0
    ? 0
    : await listAuditEntriesForCase(organizationId, caseId, dataAdapterMode).then(
        (stored) => planned.filter((e) => !stored.some((s) => s.id === e.id)).length,
        () => null,
      );

  const base = { plannedStatus, previousStatus, previousSupersededByPlanned, activeOrderId: active?.id ?? null, otherActiveOrderId, revenue, missingAuditEntries };
  const result = (allowedActions: OrderOperationRepairAction[], summary: string): OrderOperationInspection => ({ ...base, allowedActions, summary });

  if (otherActiveOrderId) {
    return result(['close'], 'The case order has been changed by something else since. No automatic repair is safe — review the order history and the ledger by hand, then close this.');
  }
  if (revenue === 'partial' && plannedStatus !== 'active' && !(kind === 'withdraw' && previousStatus === 'superseded')) {
    return result([], 'The ledger holds a partially written revenue entry for a change that is not in effect. Have it reviewed in the general ledger by hand; nothing is changed automatically.');
  }
  if (revenue === 'unknown' || missingAuditEntries === null) {
    return result([], 'The ledger or the order audit trail could not be read, so it is not known what this change already wrote. Try again later.');
  }

  if (kind === 'withdraw') {
    if (previousStatus === 'active') {
      return result(['complete', 'close'], 'The order this change was meant to withdraw is still in effect. Complete the withdrawal, or close this to keep the order.');
    }
    if (previousStatus === 'superseded' && (revenue === 'not_posted' || revenue === 'partial' || missingAuditEntries > 0)) {
      return result(['complete'], 'The order was withdrawn, but its revenue reversal or audit entry is missing. Complete the withdrawal.');
    }
    return result(['close'], 'The withdrawal is fully in place; only the journal is behind. Close it.');
  }

  switch (plannedStatus) {
    case 'missing':
    case null:
      return result(['close'], 'The new version was never saved: nothing of this change took effect, and the case order is as before. Close it; staff can make the change again.');
    case 'withdrawn':
      return result(['close'], 'This change was taken back; the case order is as before. Close it.');
    case 'superseded':
      return result(['close'], 'This change took effect and has since been replaced by a later change. Close it after checking the order history.');
    case 'pending': {
      if (revenue === 'posted') {
        return result([], 'The new version is not in effect, yet the ledger shows its revenue as posted. Review the ledger and the order by hand.');
      }
      const previousConsistent = previousOrderId === null || previousStatus === 'active' || previousSupersededByPlanned;
      if (!previousConsistent) {
        return result([], 'The version this change replaces is in an unexpected state. Review the order history by hand.');
      }
      return result(
        ['complete', 'roll_back'],
        previousSupersededByPlanned
          ? 'The previous version was replaced but the new one was never put in effect, so the case is locked. Complete the change (new version in effect, its revenue posted once), or roll it back (previous version back in effect).'
          : 'The new version was saved but never put in effect, so the case is locked. Complete the change, or roll it back (nothing is in effect but the previous version).',
      );
    }
    case 'active':
      if (revenue === 'partial') {
        return result(
          ['complete'],
          "The new version is in effect, but its revenue entry was cut off part way. Complete finishes only that entry's missing lines — after checking the stored ones are exactly what it was meant to post (otherwise it refuses and the ledger needs review by hand).",
        );
      }
      if (revenue === 'not_posted' || missingAuditEntries > 0) {
        return result(['complete'], 'The new version is in effect, but its revenue and/or audit entries were not written. Complete the change (each is written once).');
      }
      return result(['close'], 'The change is fully in place; only the journal is behind. Close it.');
  }
}

/** Finishes an interrupted operation — see the module comment. */
export async function completeOrderOperation(op: OrderOperation, ctx: ActivityContext, note: string | null, dataAdapterMode: DataAdapterMode): Promise<OrderOperationRepairOutcome> {
  const inspection = await inspectOrderOperation(op, dataAdapterMode);
  if (!inspection.allowedActions.includes('complete')) {
    return { status: 409, body: { error: `"complete" is not safe for this operation now. ${inspection.summary}`, inspection } };
  }
  const { organizationId, caseId } = op;
  const d = op.details;
  const kind = d.kind ?? 'edit';
  const plannedOrderId = d.plannedOrderId ?? null;
  const previousOrderId = d.previousOrderId ?? null;
  const claimId = plannedOrderId ?? previousOrderId;
  if (!claimId || !(await claimCaseOrderForRepair(organizationId, claimId, dataAdapterMode))) {
    return { status: 409, body: { error: 'Another repair of this operation is in progress. Reload and try again in a few minutes.', reason: 'repair_in_progress' } };
  }

  const refused = (error: string) => ({ status: 409, body: { error, inspection } });
  if (kind === 'withdraw') {
    if (inspection.previousStatus === 'active') {
      const swapped = await swapCaseOrderStatusForRepair(organizationId, previousOrderId!, 'active', 'superseded', dataAdapterMode);
      if (swapped !== 'applied') return refused(`The order could not be withdrawn (${swapped}). Nothing else was changed.`);
    }
  } else if (inspection.plannedStatus === 'pending') {
    if (previousOrderId && inspection.previousStatus === 'active') {
      const superseded = await swapCaseOrderStatusForRepair(organizationId, previousOrderId, 'active', 'superseded', dataAdapterMode, plannedOrderId!);
      if (superseded !== 'applied') return refused(`The previous version could not be replaced (${superseded}). Nothing was changed.`);
    }
    const activated = await swapCaseOrderStatusForRepair(organizationId, plannedOrderId!, 'pending', 'active', dataAdapterMode);
    if (activated !== 'applied') {
      return { status: 503, body: { error: `The new version could not be put in effect (${activated}). The operation is still listed; try again.`, inspection } };
    }
    await recordOrderOperationJournalBestEffort(ctx, { operationId: op.operationId, caseId, status: 'activated' }, dataAdapterMode);
  }

  // Audit entries and revenue — each written at most once.
  const auditWritten = await persistMissingAuditEntries(organizationId, caseId, d.auditEntries ?? [], dataAdapterMode);
  const revenueReference = d.revenueReference ?? (plannedOrderId ? orderRevenueReference(kind, plannedOrderId) : orderRevenueReference('withdraw', previousOrderId!));
  const revenuePosted = await postOrderRevenueOnce(
    {
      organizationId,
      caseId,
      serviceDelta: d.serviceDelta ?? 0,
      merchandiseDelta: d.merchandiseDelta ?? 0,
      performedBy: ctx.actorIdentityId,
      revenueReference,
      idFactory: () => crypto.randomUUID(),
    },
    dataAdapterMode,
  );

  // The balance reflects every payment taken meanwhile; a case those
  // payments settled is marked paid exactly as a payment would have.
  let balanceDue: number | null = null;
  try {
    const refreshed = await refreshBalanceForCase(organizationId, caseId, dataAdapterMode);
    balanceDue = refreshed?.balanceDue ?? null;
    if (refreshed && refreshed.balanceDue === 0 && (await getPaidAmountForCase(organizationId, caseId, dataAdapterMode)) > 0) {
      await markCasePaidIfVerified(organizationId, caseId, dataAdapterMode);
    }
  } catch (error) {
    console.error('Order operation repair: balance refresh failed (the repair itself stands):', error instanceof Error ? error.message : error);
  }

  await recordOrderOperationJournal(ctx, { operationId: op.operationId, caseId, status: 'resolved', details: { resolution: 'completed', note, revenuePosted } }, dataAdapterMode);
  return { status: 200, body: { resolved: true, resolution: 'completed', auditEntriesWritten: auditWritten, revenuePosted, balanceDue } };
}

/** Takes back an interrupted change that never took effect. */
export async function rollBackOrderOperation(op: OrderOperation, ctx: ActivityContext, note: string | null, dataAdapterMode: DataAdapterMode): Promise<OrderOperationRepairOutcome> {
  const inspection = await inspectOrderOperation(op, dataAdapterMode);
  if (!inspection.allowedActions.includes('roll_back')) {
    return { status: 409, body: { error: `"roll_back" is not safe for this operation now. ${inspection.summary}`, inspection } };
  }
  const plannedOrderId = op.details.plannedOrderId!;
  if (!(await claimCaseOrderForRepair(op.organizationId, plannedOrderId, dataAdapterMode))) {
    return { status: 409, body: { error: 'Another repair of this operation is in progress. Reload and try again in a few minutes.', reason: 'repair_in_progress' } };
  }
  const ok = await withdrawPendingOrderChange(op.organizationId, op.caseId, plannedOrderId, op.details.previousOrderId ?? null, dataAdapterMode);
  const after = await inspectOrderOperation(op, dataAdapterMode);
  if (!ok || after.plannedStatus !== 'withdrawn') {
    return { status: 503, body: { error: 'The change could not be rolled back completely. The operation is still listed; try again.', inspection: after } };
  }
  await recordOrderOperationJournal(ctx, { operationId: op.operationId, caseId: op.caseId, status: 'resolved', details: { resolution: 'rolled_back', note } }, dataAdapterMode);
  return { status: 200, body: { resolved: true, resolution: 'rolled_back', activeOrderId: after.activeOrderId } };
}

/** Records that an interrupted operation needs nothing more. */
export async function closeOrderOperation(op: OrderOperation, ctx: ActivityContext, note: string | null, dataAdapterMode: DataAdapterMode): Promise<OrderOperationRepairOutcome> {
  const inspection = await inspectOrderOperation(op, dataAdapterMode);
  if (!inspection.allowedActions.includes('close')) {
    return { status: 409, body: { error: `"close" is not safe for this operation now. ${inspection.summary}`, inspection } };
  }
  await recordOrderOperationJournal(ctx, { operationId: op.operationId, caseId: op.caseId, status: 'resolved', details: { resolution: 'closed', note } }, dataAdapterMode);
  return { status: 200, body: { resolved: true, resolution: 'closed', inspection } };
}
