import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixPurchaseOrderItem,
  buildWixPurchaseOrderData,
  applyPurchaseOrderUpdateToWixData,
  type WixPurchaseOrderItem,
} from '../lib/wixPurchaseOrderMapper';
import {
  mapWixPurchaseOrderLineItemItem,
  buildWixPurchaseOrderLineItemData,
  applyPurchaseOrderLineItemUpdateToWixData,
  type WixPurchaseOrderLineItemItem,
} from '../lib/wixPurchaseOrderLineItemMapper';
import type { PurchaseOrder, PurchaseOrderStatus } from '../types/purchaseOrder';
import type { PurchaseOrderLineItem } from '../types/purchaseOrderLineItem';
import { getSupplierById } from './supplierService';
import { getProductById } from './merchandiseService';
import { getLocationById } from './organizationLocationService';
import { receiveStock } from './inventoryService';
import { withAggregateLease, commitLeasedWrite, purchaseOrderLeaseKey } from './aggregateLeaseService';
import {
  recordPurchaseOrderCreated,
  recordPurchaseOrderSubmitted,
  recordPurchaseOrderReceived,
  recordPurchaseOrderClosed,
  recordPurchaseOrderCancelled,
  type ActivityContext,
} from './activityService';
import { purchaseOrderFixtures, purchaseOrderLineItemFixtures } from './__mocks__/procurementFixtures';

/**
 * Phase 36 (Procurement & Accounts Payable). Sole writer of `purchaseOrders`
 * and `purchaseOrderLineItems`. A purchase order is a COMMITMENT: this
 * service NEVER posts a journal entry. Physical receiving is delegated to the
 * Phase 35 inventory subsystem (`inventoryService.receiveStock`, which writes
 * the movement and posts Dr 1300 / Cr 2100 under its own per-stock-line
 * lease); this service only records the PO-line fulfillment progress and PO
 * status, under a narrow per-PO lease. See
 * docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
export class PurchaseOrderServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'invalid_input' | 'invalid_state' | 'over_receipt',
  ) {
    super(message);
    this.name = 'PurchaseOrderServiceError';
  }
}

const PO_NUMBER_WIDTH = 6;

// --- Reads ------------------------------------------------------------------

export async function listPurchaseOrdersForOrganization(organizationId: string, dataAdapterMode: DataAdapterMode, options: { status?: PurchaseOrderStatus } = {}): Promise<PurchaseOrder[]> {
  let orders: PurchaseOrder[];
  if (dataAdapterMode === 'mock') {
    orders = purchaseOrderFixtures.filter((p) => p.organizationId === organizationId);
  } else {
    const filter: Record<string, unknown> = { organizationId };
    if (options.status) filter.status = options.status;
    const response = await queryWixDataItems<WixPurchaseOrderItem>('purchaseOrders', { filter });
    orders = response.dataItems.map((i) => mapWixPurchaseOrderItem(i.data)).filter((p): p is PurchaseOrder => p !== null);
  }
  const filtered = options.status ? orders.filter((p) => p.status === options.status) : orders;
  return filtered.sort((a, b) => (a.poNumber < b.poNumber ? 1 : -1));
}

export async function getPurchaseOrderById(organizationId: string, purchaseOrderId: string, dataAdapterMode: DataAdapterMode): Promise<PurchaseOrder | null> {
  if (dataAdapterMode === 'mock') {
    return purchaseOrderFixtures.find((p) => p.organizationId === organizationId && p.id === purchaseOrderId) ?? null;
  }
  const response = await queryWixDataItems<WixPurchaseOrderItem>('purchaseOrders', {
    filter: { organizationId, beaconPurchaseOrderId: purchaseOrderId },
    paging: { limit: 1 },
  });
  return mapWixPurchaseOrderItem(response.dataItems[0]?.data);
}

export async function listLineItemsForPurchaseOrder(organizationId: string, purchaseOrderId: string, dataAdapterMode: DataAdapterMode): Promise<PurchaseOrderLineItem[]> {
  let lines: PurchaseOrderLineItem[];
  if (dataAdapterMode === 'mock') {
    lines = purchaseOrderLineItemFixtures.filter((l) => l.organizationId === organizationId && l.purchaseOrderId === purchaseOrderId);
  } else {
    const response = await queryWixDataItems<WixPurchaseOrderLineItemItem>('purchaseOrderLineItems', { filter: { organizationId, purchaseOrderId } });
    lines = response.dataItems.map((i) => mapWixPurchaseOrderLineItemItem(i.data)).filter((l): l is PurchaseOrderLineItem => l !== null);
  }
  return lines.sort((a, b) => a.lineNumber - b.lineNumber);
}

async function getLineItemById(organizationId: string, lineItemId: string, dataAdapterMode: DataAdapterMode): Promise<PurchaseOrderLineItem | null> {
  if (dataAdapterMode === 'mock') {
    return purchaseOrderLineItemFixtures.find((l) => l.organizationId === organizationId && l.id === lineItemId) ?? null;
  }
  const response = await queryWixDataItems<WixPurchaseOrderLineItemItem>('purchaseOrderLineItems', {
    filter: { organizationId, beaconPurchaseOrderLineItemId: lineItemId },
    paging: { limit: 1 },
  });
  return mapWixPurchaseOrderLineItemItem(response.dataItems[0]?.data);
}

async function nextPurchaseOrderNumber(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<string> {
  let highest = 0;
  if (dataAdapterMode === 'mock') {
    for (const p of purchaseOrderFixtures.filter((x) => x.organizationId === organizationId)) {
      const num = parseInt(p.poNumber.replace(/^PO-/, ''), 10);
      if (Number.isFinite(num) && num > highest) highest = num;
    }
  } else {
    const response = await queryWixDataItems<WixPurchaseOrderItem>('purchaseOrders', { filter: { organizationId }, sort: [{ fieldName: 'poNumber', order: 'DESC' }], paging: { limit: 1 } });
    const top = mapWixPurchaseOrderItem(response.dataItems[0]?.data);
    if (top) {
      const num = parseInt(top.poNumber.replace(/^PO-/, ''), 10);
      if (Number.isFinite(num)) highest = num;
    }
  }
  return `PO-${String(highest + 1).padStart(PO_NUMBER_WIDTH, '0')}`;
}

// --- Writes -----------------------------------------------------------------

export type CreatePurchaseOrderInput = {
  organizationId: string;
  supplierId: string;
  locationId: string;
  orderDate: string;
  expectedDate?: string | null;
  notes?: string | null;
  lines: Array<{ productId: string; quantityOrdered: number; unitCostCents: number }>;
  createdByStaffProfileId?: string | null;
  idFactory: () => string;
  now?: string;
};

export async function createPurchaseOrder(input: CreatePurchaseOrderInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<{ purchaseOrder: PurchaseOrder; lineItems: PurchaseOrderLineItem[] }> {
  if (!input.lines || input.lines.length === 0) throw new PurchaseOrderServiceError('A purchase order needs at least one line.', 'invalid_input');
  const supplier = await getSupplierById(input.organizationId, input.supplierId, dataAdapterMode);
  if (!supplier || !supplier.isActive) throw new PurchaseOrderServiceError('Supplier not found or archived.', 'invalid_input');
  const location = await getLocationById(input.organizationId, input.locationId, dataAdapterMode);
  if (!location) throw new PurchaseOrderServiceError('Location not found.', 'invalid_input');

  const nowIso = input.now ?? new Date().toISOString();
  const orderId = input.idFactory();
  const lineItems: PurchaseOrderLineItem[] = [];
  let subtotalCents = 0;
  let lineNumber = 1;
  for (const raw of input.lines) {
    if (!Number.isInteger(raw.quantityOrdered) || raw.quantityOrdered <= 0) throw new PurchaseOrderServiceError('Each line quantity must be a positive integer.', 'invalid_input');
    if (!Number.isInteger(raw.unitCostCents) || raw.unitCostCents < 0) throw new PurchaseOrderServiceError('Each line unit cost must be a non-negative integer number of cents.', 'invalid_input');
    const product = await getProductById(input.organizationId, raw.productId, dataAdapterMode);
    if (!product) throw new PurchaseOrderServiceError(`Product ${raw.productId} not found.`, 'invalid_input');
    subtotalCents += raw.quantityOrdered * raw.unitCostCents;
    lineItems.push({
      id: input.idFactory(),
      organizationId: input.organizationId,
      purchaseOrderId: orderId,
      lineNumber: lineNumber++,
      productId: raw.productId,
      locationId: input.locationId,
      descriptionSnapshot: product.name,
      quantityOrdered: raw.quantityOrdered,
      unitCostCents: raw.unitCostCents,
      quantityReceived: 0,
      quantityBilled: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  const purchaseOrder: PurchaseOrder = {
    id: orderId,
    organizationId: input.organizationId,
    poNumber: await nextPurchaseOrderNumber(input.organizationId, dataAdapterMode),
    supplierId: input.supplierId,
    locationId: input.locationId,
    status: 'draft',
    orderDate: input.orderDate,
    expectedDate: input.expectedDate ?? null,
    subtotalCents,
    notes: input.notes ?? null,
    createdByStaffProfileId: input.createdByStaffProfileId ?? null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (dataAdapterMode === 'mock') {
    purchaseOrderFixtures.push(purchaseOrder);
    purchaseOrderLineItemFixtures.push(...lineItems);
  } else {
    await insertWixDataItem('purchaseOrders', buildWixPurchaseOrderData(purchaseOrder), purchaseOrder.id);
    for (const line of lineItems) await insertWixDataItem('purchaseOrderLineItems', buildWixPurchaseOrderLineItemData(line), line.id);
  }
  await bestEffort(() => recordPurchaseOrderCreated(ctx, purchaseOrder.id, purchaseOrder.poNumber, dataAdapterMode));
  return { purchaseOrder, lineItems };
}

export async function submitPurchaseOrder(organizationId: string, purchaseOrderId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, now?: string): Promise<PurchaseOrder> {
  return withAggregateLease(purchaseOrderLeaseKey(organizationId, purchaseOrderId), dataAdapterMode, (handle) =>
    commitLeasedWrite(handle, dataAdapterMode, async () => {
      const po = await getPurchaseOrderById(organizationId, purchaseOrderId, dataAdapterMode);
      if (!po) throw new PurchaseOrderServiceError('Purchase order not found.', 'not_found');
      if (po.status !== 'draft') throw new PurchaseOrderServiceError(`Only a draft PO can be submitted (current: ${po.status}).`, 'invalid_state');
      const next = await persistPurchaseOrderStatus(po, 'submitted', now ?? new Date().toISOString(), dataAdapterMode);
      await bestEffort(() => recordPurchaseOrderSubmitted(ctx, po.id, po.poNumber, dataAdapterMode));
      return next;
    }),
  );
}

export type ReceiveAgainstPurchaseOrderInput = {
  organizationId: string;
  purchaseOrderId: string;
  receiptReference: string; // idempotency anchor for this receive action
  receipts: Array<{ purchaseOrderLineItemId: string; quantity: number; unitCostCents?: number }>;
  actorStaffProfileId?: string | null;
  idFactory: () => string;
  now?: string;
};

/**
 * Receives goods against a PO. Physical stock and GRNI accounting are done by
 * `inventoryService.receiveStock` (owner of receiving); this method updates
 * each PO line's `quantityReceived` rollup and the PO status under the per-PO
 * lease. Blocks over-receipt beyond ordered quantity (a v1 constraint).
 */
export async function receiveAgainstPurchaseOrder(input: ReceiveAgainstPurchaseOrderInput, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<PurchaseOrder> {
  if (!input.receipts || input.receipts.length === 0) throw new PurchaseOrderServiceError('Nothing to receive.', 'invalid_input');
  return withAggregateLease(purchaseOrderLeaseKey(input.organizationId, input.purchaseOrderId), dataAdapterMode, (handle) =>
    commitLeasedWrite(handle, dataAdapterMode, async () => {
      const po = await getPurchaseOrderById(input.organizationId, input.purchaseOrderId, dataAdapterMode);
      if (!po) throw new PurchaseOrderServiceError('Purchase order not found.', 'not_found');
      if (po.status !== 'submitted' && po.status !== 'partially_received') {
        throw new PurchaseOrderServiceError(`A ${po.status} PO cannot receive goods.`, 'invalid_state');
      }
      const nowIso = input.now ?? new Date().toISOString();

      for (const receipt of input.receipts) {
        if (!Number.isInteger(receipt.quantity) || receipt.quantity <= 0) throw new PurchaseOrderServiceError('Receipt quantity must be a positive integer.', 'invalid_input');
        const line = await getLineItemById(input.organizationId, receipt.purchaseOrderLineItemId, dataAdapterMode);
        if (!line || line.purchaseOrderId !== po.id) throw new PurchaseOrderServiceError('PO line not found on this purchase order.', 'invalid_input');
        if (line.quantityReceived + receipt.quantity > line.quantityOrdered) {
          throw new PurchaseOrderServiceError(`Over-receipt: line ${line.lineNumber} ordered ${line.quantityOrdered}, already received ${line.quantityReceived}, cannot receive ${receipt.quantity} more.`, 'over_receipt');
        }
        const unitCost = receipt.unitCostCents ?? line.unitCostCents;
        // Receiving is owned by the inventory subsystem — it writes the
        // movement (linked to this PO line) and posts Dr 1300 / Cr 2100.
        await receiveStock(
          {
            organizationId: input.organizationId,
            productId: line.productId,
            locationId: line.locationId,
            quantity: receipt.quantity,
            unitCost,
            supplierName: null,
            purchaseOrderLineItemId: line.id,
            receiptReference: `${input.receiptReference}-${line.id}`,
            actorStaffProfileId: input.actorStaffProfileId ?? null,
            idFactory: input.idFactory,
            now: nowIso,
          },
          ctx,
          dataAdapterMode,
        );
        await persistLineReceivedDelta(line, receipt.quantity, nowIso, dataAdapterMode);
      }

      // Recompute PO status from the (now-updated) line rollups.
      const lines = await listLineItemsForPurchaseOrder(input.organizationId, po.id, dataAdapterMode);
      const fullyReceived = lines.every((l) => l.quantityReceived >= l.quantityOrdered);
      const anyReceived = lines.some((l) => l.quantityReceived > 0);
      const nextStatus: PurchaseOrderStatus = fullyReceived ? 'received' : anyReceived ? 'partially_received' : po.status;
      const next = nextStatus !== po.status ? await persistPurchaseOrderStatus(po, nextStatus, nowIso, dataAdapterMode) : po;
      await bestEffort(() => recordPurchaseOrderReceived(ctx, po.id, po.poNumber, fullyReceived, dataAdapterMode));
      return next;
    }),
  );
}

export async function closePurchaseOrder(organizationId: string, purchaseOrderId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, now?: string): Promise<PurchaseOrder> {
  return withAggregateLease(purchaseOrderLeaseKey(organizationId, purchaseOrderId), dataAdapterMode, (handle) =>
    commitLeasedWrite(handle, dataAdapterMode, async () => {
      const po = await getPurchaseOrderById(organizationId, purchaseOrderId, dataAdapterMode);
      if (!po) throw new PurchaseOrderServiceError('Purchase order not found.', 'not_found');
      if (po.status === 'closed' || po.status === 'cancelled') throw new PurchaseOrderServiceError(`PO is already ${po.status}.`, 'invalid_state');
      const next = await persistPurchaseOrderStatus(po, 'closed', now ?? new Date().toISOString(), dataAdapterMode);
      await bestEffort(() => recordPurchaseOrderClosed(ctx, po.id, po.poNumber, dataAdapterMode));
      return next;
    }),
  );
}

export async function cancelPurchaseOrder(organizationId: string, purchaseOrderId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode, now?: string): Promise<PurchaseOrder> {
  return withAggregateLease(purchaseOrderLeaseKey(organizationId, purchaseOrderId), dataAdapterMode, (handle) =>
    commitLeasedWrite(handle, dataAdapterMode, async () => {
      const po = await getPurchaseOrderById(organizationId, purchaseOrderId, dataAdapterMode);
      if (!po) throw new PurchaseOrderServiceError('Purchase order not found.', 'not_found');
      if (po.status !== 'draft' && po.status !== 'submitted') throw new PurchaseOrderServiceError(`Only a draft or submitted PO with no receipts can be cancelled (current: ${po.status}). Use close instead.`, 'invalid_state');
      const lines = await listLineItemsForPurchaseOrder(organizationId, po.id, dataAdapterMode);
      if (lines.some((l) => l.quantityReceived > 0)) throw new PurchaseOrderServiceError('Cannot cancel a PO that has received goods. Use close instead.', 'invalid_state');
      const next = await persistPurchaseOrderStatus(po, 'cancelled', now ?? new Date().toISOString(), dataAdapterMode);
      await bestEffort(() => recordPurchaseOrderCancelled(ctx, po.id, po.poNumber, dataAdapterMode));
      return next;
    }),
  );
}

// --- internals --------------------------------------------------------------

async function persistPurchaseOrderStatus(po: PurchaseOrder, status: PurchaseOrderStatus, nowIso: string, dataAdapterMode: DataAdapterMode): Promise<PurchaseOrder> {
  const next: PurchaseOrder = { ...po, status, updatedAt: nowIso };
  if (dataAdapterMode === 'mock') {
    const idx = purchaseOrderFixtures.findIndex((p) => p.id === po.id);
    if (idx >= 0) purchaseOrderFixtures[idx] = next;
    return next;
  }
  const response = await queryWixDataItems<WixPurchaseOrderItem>('purchaseOrders', { filter: { organizationId: po.organizationId, beaconPurchaseOrderId: po.id }, paging: { limit: 1 } });
  const raw = response.dataItems[0]?.data;
  if (!raw) throw new PurchaseOrderServiceError('Purchase order not found.', 'not_found');
  await updateWixDataItem('purchaseOrders', po.id, applyPurchaseOrderUpdateToWixData(raw, { status, updatedAt: nowIso }));
  return next;
}

/** Increment a PO line's received rollup by `delta` (also used, negatively,
    nowhere yet — reserved for future receipt corrections). */
async function persistLineReceivedDelta(line: PurchaseOrderLineItem, delta: number, nowIso: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  const nextReceived = line.quantityReceived + delta;
  if (dataAdapterMode === 'mock') {
    const idx = purchaseOrderLineItemFixtures.findIndex((l) => l.id === line.id);
    if (idx >= 0) purchaseOrderLineItemFixtures[idx] = { ...line, quantityReceived: nextReceived, updatedAt: nowIso };
    return;
  }
  const response = await queryWixDataItems<WixPurchaseOrderLineItemItem>('purchaseOrderLineItems', { filter: { organizationId: line.organizationId, beaconPurchaseOrderLineItemId: line.id }, paging: { limit: 1 } });
  const raw = response.dataItems[0]?.data;
  if (!raw) throw new PurchaseOrderServiceError('PO line not found.', 'not_found');
  await updateWixDataItem('purchaseOrderLineItems', line.id, applyPurchaseOrderLineItemUpdateToWixData(raw, { quantityReceived: nextReceived, updatedAt: nowIso }));
}

/** Adjust a PO line's billed rollup — called by accountsPayableService when
    a bill posts or voids (kept here so this service stays the sole writer of
    purchaseOrderLineItems). */
export async function applyBilledDelta(organizationId: string, lineItemId: string, delta: number, dataAdapterMode: DataAdapterMode, now?: string): Promise<void> {
  const line = await getLineItemById(organizationId, lineItemId, dataAdapterMode);
  if (!line) return; // best-effort rollup; authoritative value is derivable from bill lines
  const nowIso = now ?? new Date().toISOString();
  const nextBilled = Math.max(0, line.quantityBilled + delta);
  if (dataAdapterMode === 'mock') {
    const idx = purchaseOrderLineItemFixtures.findIndex((l) => l.id === line.id);
    if (idx >= 0) purchaseOrderLineItemFixtures[idx] = { ...line, quantityBilled: nextBilled, updatedAt: nowIso };
    return;
  }
  const response = await queryWixDataItems<WixPurchaseOrderLineItemItem>('purchaseOrderLineItems', { filter: { organizationId, beaconPurchaseOrderLineItemId: line.id }, paging: { limit: 1 } });
  const raw = response.dataItems[0]?.data;
  if (!raw) return;
  await updateWixDataItem('purchaseOrderLineItems', line.id, applyPurchaseOrderLineItemUpdateToWixData(raw, { quantityBilled: nextBilled, updatedAt: nowIso }));
}

async function bestEffort(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    /* swallow */
  }
}
