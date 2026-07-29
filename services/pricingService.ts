import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixServiceCatalogItem,
  type WixServiceCatalogItem,
} from '../lib/wixServiceCatalogMapper';
import {
  mapWixCaseOrderItem,
  buildWixCaseOrderData,
  applyCaseOrderUpdateToWixData,
  type WixCaseOrderItem,
} from '../lib/wixCaseOrderMapper';
import {
  mapWixCaseOrderLineItemItem,
  buildWixCaseOrderLineItemData,
  type WixCaseOrderLineItemItem,
} from '../lib/wixCaseOrderLineItemMapper';
import {
  mapWixCaseOrderAuditItem,
  buildWixCaseOrderAuditData,
  type WixCaseOrderAuditItem,
} from '../lib/wixCaseOrderAuditMapper';
import type { ServiceCatalogItem } from '../types/serviceCatalog';
import type { CaseOrder, CaseOrderLineItem } from '../types/caseOrder';
import type { CaseOrderAuditEntry } from '../types/caseOrderAudit';
import {
  calculateAdjustment,
  calculateBalance,
  calculateOrderTotals,
  normalizeSelections,
  selectionsFromLineItems,
} from '../domain/pricing/calculateOrder';
import { diffSelections } from '../domain/pricing/auditDiff';
import { listPaymentRecordsForCase } from './paymentsService';
import { recordCaseOrderChanged } from './activityService';
import {
  serviceCatalogFixtures,
  caseOrderFixtures,
  caseOrderLineItemFixtures,
  caseOrderAuditFixtures,
} from './__mocks__/pricingFixtures';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Beacon's
 * pricing engine's orchestration/persistence layer — see
 * docs/adr/ADR-023-case-order-pricing-engine.md. All arithmetic lives in
 * domain/pricing/ (pure, shareable with the browser's live-preview
 * summary); everything here is I/O — fetching the catalog, persisting
 * CaseOrders/line items/audit entries, and computing balances from real
 * PaymentRecord history (reusing services/paymentsService.ts, never
 * duplicating its logic — "Do not duplicate pricing logic").
 *
 * Same organization-scoped, dataAdapterMode-branching shape as every other
 * service in this codebase.
 */

export { calculateAdjustment, calculateBalance };

/** Re-exported/re-normalized here so a caller only ever needs to import
    from this one service module for the "calculateTotals" responsibility
    the phase's own spec names — normalizes untrusted selections before
    calculating, exactly like createCaseOrder/recalculateOrder do. */
export function calculateTotals(catalog: ServiceCatalogItem[], rawSelections: unknown) {
  const selections = normalizeSelections((rawSelections ?? {}) as Record<string, unknown>);
  return calculateOrderTotals(catalog, selections);
}

export async function getServiceCatalog(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  options: { includeInactive?: boolean } = {},
): Promise<ServiceCatalogItem[]> {
  let items: ServiceCatalogItem[];
  if (dataAdapterMode === 'mock') {
    items = serviceCatalogFixtures.filter((item) => item.organizationId === organizationId);
  } else {
    const response = await queryWixDataItems<WixServiceCatalogItem>('serviceCatalog', {
      filter: { organizationId },
    });
    items = response.dataItems
      .map((item) => mapWixServiceCatalogItem(item.data))
      .filter((item): item is ServiceCatalogItem => item !== null);
  }
  const filtered = options.includeInactive ? items : items.filter((item) => item.isActive);
  return filtered.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getActiveCaseOrder(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder | null> {
  if (dataAdapterMode === 'mock') {
    return (
      caseOrderFixtures.find(
        (o) => o.organizationId === organizationId && o.caseId === caseId && o.status === 'active',
      ) ?? null
    );
  }
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, caseId, status: 'active' },
    paging: { limit: 1 },
  });
  return mapWixCaseOrderItem(response.dataItems[0]?.data);
}

export async function listCaseOrderVersions(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder[]> {
  if (dataAdapterMode === 'mock') {
    return caseOrderFixtures
      .filter((o) => o.organizationId === organizationId && o.caseId === caseId)
      .sort((a, b) => b.version - a.version);
  }
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, caseId },
  });
  return response.dataItems
    .map((item) => mapWixCaseOrderItem(item.data))
    .filter((o): o is CaseOrder => o !== null)
    .sort((a, b) => b.version - a.version);
}

export async function listLineItemsForOrder(
  organizationId: string,
  caseOrderId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrderLineItem[]> {
  if (dataAdapterMode === 'mock') {
    return caseOrderLineItemFixtures
      .filter((li) => li.organizationId === organizationId && li.caseOrderId === caseOrderId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const response = await queryWixDataItems<WixCaseOrderLineItemItem>('caseOrderLineItems', {
    filter: { organizationId, caseOrderId },
  });
  return response.dataItems
    .map((item) => mapWixCaseOrderLineItemItem(item.data))
    .filter((li): li is CaseOrderLineItem => li !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function listAuditEntriesForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrderAuditEntry[]> {
  if (dataAdapterMode === 'mock') {
    return caseOrderAuditFixtures
      .filter((e) => e.organizationId === organizationId && e.caseId === caseId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  const response = await queryWixDataItems<WixCaseOrderAuditItem>('caseOrderAuditEntries', {
    filter: { organizationId, caseId },
  });
  return response.dataItems
    .map((item) => mapWixCaseOrderAuditItem(item.data))
    .filter((e): e is CaseOrderAuditEntry => e !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Sum of every 'succeeded' PaymentRecord for this case, across every
    CaseOrder version it has ever had — the one place "how much has this
    case actually been paid" is computed, reused by both createCaseOrder's
    balance seed (always 0 for a brand-new case, but computed the same way
    for consistency) and recalculateOrder's balance refresh. */
export async function getPaidAmountForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<number> {
  const payments = await listPaymentRecordsForCase(organizationId, caseId, dataAdapterMode);
  return payments.filter((p) => p.status === 'succeeded').reduce((sum, p) => sum + p.amount, 0);
}

async function persistCaseOrder(order: CaseOrder, dataAdapterMode: DataAdapterMode): Promise<CaseOrder> {
  if (dataAdapterMode === 'mock') {
    caseOrderFixtures.push(order);
    return order;
  }
  const inserted = await insertWixDataItem<WixCaseOrderItem>('caseOrders', buildWixCaseOrderData(order), order.id);
  const mapped = mapWixCaseOrderItem(inserted.data);
  if (!mapped) throw new Error('Failed to create case order.');
  return mapped;
}

async function persistLineItems(lineItems: CaseOrderLineItem[], dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    caseOrderLineItemFixtures.push(...lineItems);
    return;
  }
  for (const lineItem of lineItems) {
    await insertWixDataItem<WixCaseOrderLineItemItem>(
      'caseOrderLineItems',
      buildWixCaseOrderLineItemData(lineItem),
      lineItem.id,
    );
  }
}

async function persistAuditEntries(entries: CaseOrderAuditEntry[], dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    caseOrderAuditFixtures.push(...entries);
    return;
  }
  for (const entry of entries) {
    await insertWixDataItem<WixCaseOrderAuditItem>('caseOrderAuditEntries', buildWixCaseOrderAuditData(entry), entry.id);
  }
}

async function markCaseOrderSuperseded(
  organizationId: string,
  caseOrderId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (dataAdapterMode === 'mock') {
    const index = caseOrderFixtures.findIndex((o) => o.organizationId === organizationId && o.id === caseOrderId);
    if (index !== -1) caseOrderFixtures[index] = { ...caseOrderFixtures[index], status: 'superseded', updatedAt: nowIso };
    return;
  }
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, beaconCaseOrderId: caseOrderId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;
  const mergedData = applyCaseOrderUpdateToWixData(existingItem.data, { status: 'superseded', updatedAt: nowIso });
  await updateWixDataItem('caseOrders', existingItem.id, mergedData);
}

function buildLineItems(
  organizationId: string,
  caseOrderId: string,
  calculated: ReturnType<typeof calculateOrderTotals>,
  nowIso: string,
  idFactory: () => string,
): CaseOrderLineItem[] {
  return calculated.lineItems.map((item) => ({
    id: idFactory(),
    organizationId,
    caseOrderId,
    serviceCode: item.serviceCode,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
    sortOrder: item.sortOrder,
    metadata: null,
    createdAt: nowIso,
  }));
}

/**
 * Creates a case's first CaseOrder (version 1) from staff-submitted
 * selections — never a submitted total. Always re-fetches the catalog and
 * recalculates server-side (see domain/pricing/calculateOrder.ts). Writes
 * one 'order_created' audit entry so every case's pricing history starts
 * from a real, timestamped record, not an implicit zero state.
 */
export async function createCaseOrder(
  params: {
    organizationId: string;
    caseId: string;
    selections: unknown;
    performedBy: string;
    idFactory: () => string;
    now?: string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<{ order: CaseOrder; lineItems: CaseOrderLineItem[]; auditEntry: CaseOrderAuditEntry }> {
  const nowIso = params.now ?? new Date().toISOString();
  const catalog = await getServiceCatalog(params.organizationId, dataAdapterMode);
  const selections = normalizeSelections((params.selections ?? {}) as Record<string, unknown>);
  const calculated = calculateOrderTotals(catalog, selections);

  const orderId = params.idFactory();
  const order: CaseOrder = {
    id: orderId,
    organizationId: params.organizationId,
    caseId: params.caseId,
    status: 'active',
    subtotal: calculated.subtotal,
    discountTotal: calculated.discountTotal,
    taxTotal: calculated.taxTotal,
    total: calculated.total,
    balanceDue: calculateBalance(calculated.total, 0),
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const lineItems = buildLineItems(params.organizationId, orderId, calculated, nowIso, params.idFactory);

  const auditEntry: CaseOrderAuditEntry = {
    id: params.idFactory(),
    organizationId: params.organizationId,
    caseId: params.caseId,
    caseOrderId: orderId,
    action: 'order_created',
    previousValue: null,
    newValue: null,
    amountDeltaCents: calculated.total,
    description: `Case order created — ${calculated.lineItems.length} service${calculated.lineItems.length === 1 ? '' : 's'}`,
    performedBy: params.performedBy,
    createdAt: nowIso,
  };

  const persistedOrder = await persistCaseOrder(order, dataAdapterMode);
  await persistLineItems(lineItems, dataAdapterMode);
  await persistAuditEntries([auditEntry], dataAdapterMode);

  return { order: persistedOrder, lineItems, auditEntry };
}

/**
 * Edits a case's services: supersedes the current active CaseOrder,
 * creates a new version reflecting the new selections, and appends one
 * audit entry per individual change (weight tier / death certificate
 * quantity / mail cremated remains). Returns null if the case has no
 * active CaseOrder to edit (callers should treat this as 404, not a silent
 * create — editing is distinct from initial creation). Returns the
 * unchanged current order (no new version, no audit entries) if the new
 * selections are identical to the current ones — a no-op edit should never
 * pollute the version/audit history.
 */
export async function recalculateOrder(
  params: {
    organizationId: string;
    caseId: string;
    selections: unknown;
    performedBy: string;
    idFactory: () => string;
    now?: string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<{ order: CaseOrder; lineItems: CaseOrderLineItem[]; auditEntries: CaseOrderAuditEntry[] } | null> {
  const current = await getActiveCaseOrder(params.organizationId, params.caseId, dataAdapterMode);
  if (!current) return null;

  const nowIso = params.now ?? new Date().toISOString();
  const catalog = await getServiceCatalog(params.organizationId, dataAdapterMode);
  const currentLineItems = await listLineItemsForOrder(params.organizationId, current.id, dataAdapterMode);
  const previousSelections = selectionsFromLineItems(currentLineItems);
  const nextSelections = normalizeSelections((params.selections ?? {}) as Record<string, unknown>);

  const diffEntries = diffSelections(catalog, previousSelections, nextSelections);
  if (diffEntries.length === 0) {
    return { order: current, lineItems: currentLineItems, auditEntries: [] };
  }

  const calculated = calculateOrderTotals(catalog, nextSelections);
  const paidAmount = await getPaidAmountForCase(params.organizationId, params.caseId, dataAdapterMode);

  const newOrderId = params.idFactory();
  const newOrder: CaseOrder = {
    id: newOrderId,
    organizationId: params.organizationId,
    caseId: params.caseId,
    status: 'active',
    subtotal: calculated.subtotal,
    discountTotal: calculated.discountTotal,
    taxTotal: calculated.taxTotal,
    total: calculated.total,
    balanceDue: calculateBalance(calculated.total, paidAmount),
    version: current.version + 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const newLineItems = buildLineItems(params.organizationId, newOrderId, calculated, nowIso, params.idFactory);

  const auditEntries: CaseOrderAuditEntry[] = diffEntries.map((entry) => ({
    id: params.idFactory(),
    organizationId: params.organizationId,
    caseId: params.caseId,
    caseOrderId: newOrderId,
    action: entry.action,
    previousValue: entry.previousValue,
    newValue: entry.newValue,
    amountDeltaCents: entry.amountDeltaCents,
    description: entry.description,
    performedBy: params.performedBy,
    createdAt: nowIso,
  }));

  await markCaseOrderSuperseded(params.organizationId, current.id, dataAdapterMode);
  const persistedOrder = await persistCaseOrder(newOrder, dataAdapterMode);
  await persistLineItems(newLineItems, dataAdapterMode);
  await persistAuditEntries(auditEntries, dataAdapterMode);

  // Phase 24 (Case Activity Timeline & Audit Center): one activity event
  // summarizing this whole recalculation, reusing the exact diff data
  // already computed above — best-effort, never fails the actual order
  // update. `performedBy` carries no resolved membership/role here (this
  // service has no auth context of its own — see this file's own
  // "no new authorization logic" convention), so those two fields are null.
  try {
    await recordCaseOrderChanged(
      { organizationId: params.organizationId, actorIdentityId: params.performedBy, actorMembershipId: null, actorRoleKey: null, correlationId: newOrderId },
      params.caseId,
      newOrderId,
      diffEntries,
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record case.order.changed activity event:', error instanceof Error ? error.message : error);
  }

  return { order: persistedOrder, lineItems: newLineItems, auditEntries };
}

/**
 * Refreshes only balanceDue on the case's current active CaseOrder — used
 * after a payment succeeds (paymentWorkflow.ts), never touches subtotal/
 * total/version/status. Never creates a new version — a payment is not an
 * edit to what was ordered.
 */
export async function refreshBalanceForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder | null> {
  const order = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
  if (!order) return null;
  const paidAmount = await getPaidAmountForCase(organizationId, caseId, dataAdapterMode);
  const balanceDue = calculateBalance(order.total, paidAmount);
  if (balanceDue === order.balanceDue) return order;

  const nowIso = new Date().toISOString();
  if (dataAdapterMode === 'mock') {
    const index = caseOrderFixtures.findIndex((o) => o.organizationId === organizationId && o.id === order.id);
    if (index !== -1) caseOrderFixtures[index] = { ...caseOrderFixtures[index], balanceDue, updatedAt: nowIso };
    return caseOrderFixtures[index] ?? null;
  }

  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, beaconCaseOrderId: order.id },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const mergedData = applyCaseOrderUpdateToWixData(existingItem.data, { balanceDue, updatedAt: nowIso });
  const updated = await updateWixDataItem<WixCaseOrderItem>('caseOrders', existingItem.id, mergedData);
  return mapWixCaseOrderItem(updated.data);
}
