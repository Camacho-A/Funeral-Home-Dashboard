import type { CaseOrder, CaseOrderStatus } from '../types/caseOrder';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). The one place a
 * raw Wix `caseOrders` item is ever touched. CaseOrder rows are
 * append-only (see types/caseOrder.ts's own comment) — the only update
 * this collection ever receives is flipping a superseded row's `status`
 * from 'active' to 'superseded' when a new version is created, hence
 * applyCaseOrderStatusUpdateToWixData below being the one narrow update
 * helper rather than a general patch merge like paymentRecords has.
 */
const VALID_STATUSES: CaseOrderStatus[] = ['active', 'superseded'];

function isValidStatus(value: unknown): value is CaseOrderStatus {
  return typeof value === 'string' && (VALID_STATUSES as string[]).includes(value);
}

export type WixCaseOrderItem = {
  beaconCaseOrderId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  status?: unknown;
  subtotal?: unknown;
  discountTotal?: unknown;
  taxTotal?: unknown;
  total?: unknown;
  balanceDue?: unknown;
  version?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixCaseOrderItem(item: WixCaseOrderItem | undefined): CaseOrder | null {
  if (
    !item ||
    typeof item.beaconCaseOrderId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    !isValidStatus(item.status) ||
    typeof item.subtotal !== 'number' ||
    typeof item.discountTotal !== 'number' ||
    typeof item.taxTotal !== 'number' ||
    typeof item.total !== 'number' ||
    typeof item.balanceDue !== 'number' ||
    typeof item.version !== 'number' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconCaseOrderId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    status: item.status,
    subtotal: item.subtotal,
    discountTotal: item.discountTotal,
    taxTotal: item.taxTotal,
    total: item.total,
    balanceDue: item.balanceDue,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixCaseOrderData(order: CaseOrder): WixCaseOrderItem {
  return {
    beaconCaseOrderId: order.id,
    organizationId: order.organizationId,
    caseId: order.caseId,
    status: order.status,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    taxTotal: order.taxTotal,
    total: order.total,
    balanceDue: order.balanceDue,
    version: order.version,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/** Merges a partial patch (status flip on supersede; balanceDue refresh
    when a payment succeeds) onto the existing full Wix item — Wix Data's
    updateDataItem is a full replace, same reasoning as every other mapper
    here. */
export function applyCaseOrderUpdateToWixData(existing: WixCaseOrderItem, patch: Partial<CaseOrder>): WixCaseOrderItem {
  const next: WixCaseOrderItem = { ...existing };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.balanceDue !== undefined) next.balanceDue = patch.balanceDue;
  if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt;
  return next;
}
