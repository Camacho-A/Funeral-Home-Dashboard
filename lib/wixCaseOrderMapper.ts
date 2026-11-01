import type { CaseOrder, CaseOrderStatus } from '../types/caseOrder';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). The one place a
 * raw Wix `caseOrders` item is ever touched. CaseOrder rows are
 * append-only (see types/caseOrder.ts's own comment). The only changes a
 * row ever receives after its insert are field-scoped, conditional patches
 * made by services/pricingService.ts — the status flip (with
 * `supersededAt`/`supersededByOrderId`) when a newer version replaces it,
 * and the active row's `balanceDue` refresh. There is deliberately no
 * full-row update helper here any more (2026-10): a full replace from an
 * earlier read could silently undo a concurrent write. See
 * docs/ORDER_VERSIONING.md.
 */
const VALID_STATUSES: CaseOrderStatus[] = ['active', 'superseded', 'pending', 'withdrawn'];

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
  supersededAt?: unknown;
  supersededByOrderId?: unknown;
  supersedesOrderId?: unknown;
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
    // Optional (2026-10): absent on legacy rows and on every active row.
    ...(typeof item.supersededAt === 'string' ? { supersededAt: item.supersededAt } : {}),
    ...(typeof item.supersededByOrderId === 'string' ? { supersededByOrderId: item.supersededByOrderId } : {}),
    ...(typeof item.supersedesOrderId === 'string' ? { supersedesOrderId: item.supersedesOrderId } : {}),
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
    ...(order.supersededAt ? { supersededAt: order.supersededAt } : {}),
    ...(order.supersededByOrderId ? { supersededByOrderId: order.supersededByOrderId } : {}),
    ...(order.supersedesOrderId ? { supersedesOrderId: order.supersedesOrderId } : {}),
  };
}
