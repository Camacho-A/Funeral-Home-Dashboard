import type { CaseOrderAuditEntry } from '../types/caseOrderAudit';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). The one place a
 * raw Wix `caseOrderAuditEntries` item is ever touched. Append-only, same
 * as caseOrderLineItems — no update helper, only map/build.
 */
export type WixCaseOrderAuditItem = {
  beaconAuditEntryId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  caseOrderId?: unknown;
  action?: unknown;
  previousValue?: unknown;
  newValue?: unknown;
  amountDeltaCents?: unknown;
  description?: unknown;
  performedBy?: unknown;
  createdAt?: unknown;
};

export function mapWixCaseOrderAuditItem(item: WixCaseOrderAuditItem | undefined): CaseOrderAuditEntry | null {
  if (
    !item ||
    typeof item.beaconAuditEntryId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    typeof item.caseOrderId !== 'string' ||
    typeof item.action !== 'string' ||
    typeof item.amountDeltaCents !== 'number' ||
    typeof item.description !== 'string' ||
    typeof item.performedBy !== 'string' ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconAuditEntryId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    caseOrderId: item.caseOrderId,
    action: item.action,
    previousValue: typeof item.previousValue === 'string' ? item.previousValue : null,
    newValue: typeof item.newValue === 'string' ? item.newValue : null,
    amountDeltaCents: item.amountDeltaCents,
    description: item.description,
    performedBy: item.performedBy,
    createdAt: item.createdAt,
  };
}

export function buildWixCaseOrderAuditData(entry: CaseOrderAuditEntry): WixCaseOrderAuditItem {
  return {
    beaconAuditEntryId: entry.id,
    organizationId: entry.organizationId,
    caseId: entry.caseId,
    caseOrderId: entry.caseOrderId,
    action: entry.action,
    previousValue: entry.previousValue,
    newValue: entry.newValue,
    amountDeltaCents: entry.amountDeltaCents,
    description: entry.description,
    performedBy: entry.performedBy,
    createdAt: entry.createdAt,
  };
}
