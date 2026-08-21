import type { CaseOrderLineItem, CaseOrderLineKind } from '../types/caseOrder';

const VALID_LINE_KINDS: readonly CaseOrderLineKind[] = ['service', 'merchandise', 'surcharge', 'adjustment', 'tax', 'discount'];

function isLineKind(value: unknown): value is CaseOrderLineKind {
  return typeof value === 'string' && (VALID_LINE_KINDS as readonly string[]).includes(value);
}

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). The one place a
 * raw Wix `caseOrderLineItems` item is ever touched. Line items are
 * write-once — created alongside their CaseOrder and never edited or
 * deleted afterward (an edit produces a whole new CaseOrder version with
 * its own fresh line items) — so there is no update helper here at all,
 * only map/build.
 */
export type WixCaseOrderLineItemItem = {
  beaconLineItemId?: unknown;
  organizationId?: unknown;
  caseOrderId?: unknown;
  lineKind?: unknown;
  serviceCode?: unknown;
  description?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  lineTotal?: unknown;
  sortOrder?: unknown;
  metadata?: unknown;
  createdAt?: unknown;
};

function isMetadataRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
}

export function mapWixCaseOrderLineItemItem(item: WixCaseOrderLineItemItem | undefined): CaseOrderLineItem | null {
  if (
    !item ||
    typeof item.beaconLineItemId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseOrderId !== 'string' ||
    typeof item.serviceCode !== 'string' ||
    typeof item.description !== 'string' ||
    typeof item.quantity !== 'number' ||
    typeof item.unitPrice !== 'number' ||
    typeof item.lineTotal !== 'number' ||
    typeof item.sortOrder !== 'number' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconLineItemId,
    organizationId: item.organizationId,
    caseOrderId: item.caseOrderId,
    // Phase 35: every historical (pre-Phase-35) row has no lineKind — it
    // defaults to 'service', keeping every existing service-only order
    // byte-for-byte compatible. A merchandise line always writes an explicit
    // 'merchandise' value.
    lineKind: isLineKind(item.lineKind) ? item.lineKind : 'service',
    serviceCode: item.serviceCode,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
    sortOrder: item.sortOrder,
    metadata: isMetadataRecord(item.metadata) ? item.metadata : null,
    createdAt: item.createdAt,
  };
}

export function buildWixCaseOrderLineItemData(lineItem: CaseOrderLineItem): WixCaseOrderLineItemItem {
  return {
    beaconLineItemId: lineItem.id,
    organizationId: lineItem.organizationId,
    caseOrderId: lineItem.caseOrderId,
    lineKind: lineItem.lineKind,
    serviceCode: lineItem.serviceCode,
    description: lineItem.description,
    quantity: lineItem.quantity,
    unitPrice: lineItem.unitPrice,
    lineTotal: lineItem.lineTotal,
    sortOrder: lineItem.sortOrder,
    metadata: lineItem.metadata,
    createdAt: lineItem.createdAt,
  };
}
