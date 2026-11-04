import type { OrderOperationRepairAction } from '@/services/orderOperationRepair';

/**
 * Order recovery (2026-11): browser calls for the administrator's recovery
 * panel on the case order. Both routes already existed (Phase 5A.2) and do
 * every check server-side — admin-tier plus caseOrder.update, the caller's
 * own organization only, and a repair only when the current order rows and
 * ledger make it safe.
 */

export type RecoveryInspection = {
  plannedStatus: string | null;
  previousStatus: string | null;
  activeOrderId: string | null;
  otherActiveOrderId: string | null;
  revenue: 'posted' | 'not_posted' | 'not_needed' | 'partial' | 'unknown';
  missingAuditEntries: number | null;
  allowedActions: OrderOperationRepairAction[];
  summary: string;
};

export type RecoverableOrderOperation = {
  operationId: string;
  caseId: string;
  status: string;
  startedAt: string;
  updatedAt: string;
  startedBy: string | null;
  details: {
    kind?: string;
    previousOrderId?: string | null;
    previousVersion?: number | null;
    plannedOrderId?: string | null;
    plannedVersion?: number | null;
    plannedTotal?: number | null;
  };
  interrupted: boolean;
  inspection: RecoveryInspection | null;
};

export class OrderRecoveryRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'OrderRecoveryRequestError';
  }
}

async function failure(response: Response, fallback: string): Promise<OrderRecoveryRequestError> {
  const body = await response.json().catch(() => ({}));
  return new OrderRecoveryRequestError(typeof body.error === 'string' ? body.error : fallback, response.status);
}

/** The interrupted order changes of one case (read-only). */
export async function fetchCaseOrderRecovery(organizationId: string, caseId: string): Promise<RecoverableOrderOperation[]> {
  const response = await fetch(`/api/cases/order-operations?organizationId=${encodeURIComponent(organizationId)}&caseId=${encodeURIComponent(caseId)}`, { cache: 'no-store' });
  if (!response.ok) throw await failure(response, 'The interrupted change could not be loaded.');
  return ((await response.json()) as { operations: RecoverableOrderOperation[] }).operations;
}

export async function repairCaseOrderOperation(
  organizationId: string,
  operationId: string,
  action: OrderOperationRepairAction,
  note: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/cases/order-operations/${encodeURIComponent(operationId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, action, note }),
  });
  if (!response.ok) throw await failure(response, 'The repair could not be completed.');
  return response.json();
}
