import type { Supplier } from '@/types/supplier';
import type { PurchaseOrder } from '@/types/purchaseOrder';
import type { PurchaseOrderLineItem } from '@/types/purchaseOrderLineItem';
import type { VendorBill } from '@/types/vendorBill';
import type { VendorBillLineItem } from '@/types/vendorBillLineItem';
import type { BillPayment } from '@/types/billPayment';

/**
 * Phase 36 (Procurement & Accounts Payable). Client-side fetch wrappers for
 * the procurement/AP routes — thin, typed, one per route, mirroring
 * lib/merchandiseClient.ts. All mutating calls are same-origin (CSRF-checked
 * server-side). No accounting math happens here — the client submits intent
 * (which receipts, which accounts) and the server computes every total.
 */
async function parse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.');
  return body;
}
const jsonHeaders = { 'Content-Type': 'application/json' };

// --- Suppliers --------------------------------------------------------------
export async function fetchSuppliers(organizationId: string, includeInactive = false): Promise<Supplier[]> {
  const params = new URLSearchParams({ organizationId, ...(includeInactive ? { includeInactive: 'true' } : {}) });
  return ((await parse(await fetch(`/api/procurement/suppliers?${params}`))).suppliers as Supplier[]) ?? [];
}
export type CreateSupplierInput = { organizationId: string; name: string; contactName?: string | null; email?: string | null; phone?: string | null; addressText?: string | null; paymentTermsDays?: number | null; defaultExpenseAccountNumber?: string | null; notes?: string | null };
export async function createSupplierRequest(input: CreateSupplierInput): Promise<Supplier> {
  return (await parse(await fetch('/api/procurement/suppliers', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }))).supplier as Supplier;
}
export async function archiveSupplierRequest(organizationId: string, supplierId: string): Promise<Supplier> {
  return (await parse(await fetch(`/api/procurement/suppliers/${encodeURIComponent(supplierId)}?organizationId=${encodeURIComponent(organizationId)}`, { method: 'DELETE', headers: jsonHeaders }))).supplier as Supplier;
}

// --- Purchase orders --------------------------------------------------------
export async function fetchPurchaseOrders(organizationId: string): Promise<PurchaseOrder[]> {
  return ((await parse(await fetch(`/api/procurement/purchase-orders?organizationId=${encodeURIComponent(organizationId)}`))).purchaseOrders as PurchaseOrder[]) ?? [];
}
export async function fetchPurchaseOrder(organizationId: string, purchaseOrderId: string): Promise<{ purchaseOrder: PurchaseOrder; lineItems: PurchaseOrderLineItem[] }> {
  const body = await parse(await fetch(`/api/procurement/purchase-orders/${encodeURIComponent(purchaseOrderId)}?organizationId=${encodeURIComponent(organizationId)}`));
  return { purchaseOrder: body.purchaseOrder as PurchaseOrder, lineItems: (body.lineItems as PurchaseOrderLineItem[]) ?? [] };
}
export type CreatePurchaseOrderInput = { organizationId: string; supplierId: string; locationId: string; orderDate: string; expectedDate?: string | null; notes?: string | null; lines: Array<{ productId: string; quantityOrdered: number; unitCostCents: number }> };
export async function createPurchaseOrderRequest(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
  return (await parse(await fetch('/api/procurement/purchase-orders', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }))).purchaseOrder as PurchaseOrder;
}
async function poAction(organizationId: string, purchaseOrderId: string, action: 'submit' | 'close' | 'cancel'): Promise<PurchaseOrder> {
  return (await parse(await fetch(`/api/procurement/purchase-orders/${encodeURIComponent(purchaseOrderId)}/${action}`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ organizationId }) }))).purchaseOrder as PurchaseOrder;
}
export const submitPurchaseOrderRequest = (o: string, p: string) => poAction(o, p, 'submit');
export const closePurchaseOrderRequest = (o: string, p: string) => poAction(o, p, 'close');
export const cancelPurchaseOrderRequest = (o: string, p: string) => poAction(o, p, 'cancel');
export async function receiveAgainstPurchaseOrderRequest(organizationId: string, purchaseOrderId: string, receipts: Array<{ purchaseOrderLineItemId: string; quantity: number; unitCostCents?: number }>): Promise<PurchaseOrder> {
  return (await parse(await fetch(`/api/procurement/purchase-orders/${encodeURIComponent(purchaseOrderId)}/receive`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ organizationId, receipts }) }))).purchaseOrder as PurchaseOrder;
}
export async function fetchBillableReceipts(organizationId: string, purchaseOrderId: string): Promise<Array<{ receiptMovementId: string; productId: string; billableQuantity: number; receiptUnitCostCents: number }>> {
  return ((await parse(await fetch(`/api/procurement/purchase-orders/${encodeURIComponent(purchaseOrderId)}/billable-receipts?organizationId=${encodeURIComponent(organizationId)}`))).billableReceipts as Array<{ receiptMovementId: string; productId: string; billableQuantity: number; receiptUnitCostCents: number }>) ?? [];
}

// --- Vendor bills + payments ------------------------------------------------
export async function fetchBills(organizationId: string): Promise<VendorBill[]> {
  return ((await parse(await fetch(`/api/accounting/bills?organizationId=${encodeURIComponent(organizationId)}`))).bills as VendorBill[]) ?? [];
}
export async function fetchBill(organizationId: string, billId: string): Promise<{ bill: VendorBill; lineItems: VendorBillLineItem[]; payments: BillPayment[] }> {
  const body = await parse(await fetch(`/api/accounting/bills/${encodeURIComponent(billId)}?organizationId=${encodeURIComponent(organizationId)}`));
  return { bill: body.bill as VendorBill, lineItems: (body.lineItems as VendorBillLineItem[]) ?? [], payments: (body.payments as BillPayment[]) ?? [] };
}
export type CreateBillInput = { organizationId: string; supplierId: string; billNumber: string; purchaseOrderId?: string | null; billDate: string; dueDate: string; goodsLines: Array<{ receiptMovementId: string; quantityBilled: number; billedUnitCostCents: number }>; expenseLines: Array<{ accountNumber: string; amountCents: number; description?: string | null }> };
export async function createBillRequest(input: CreateBillInput): Promise<VendorBill> {
  return (await parse(await fetch('/api/accounting/bills', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }))).bill as VendorBill;
}
export async function voidBillRequest(organizationId: string, billId: string, reason?: string): Promise<VendorBill> {
  return (await parse(await fetch(`/api/accounting/bills/${encodeURIComponent(billId)}/void`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ organizationId, reason }) }))).bill as VendorBill;
}
export type RecordPaymentInput = { organizationId: string; amountCents: number; paymentDate: string; method: string; referenceNumber?: string | null; cashAccountNumber: string; notes?: string | null };
export async function recordPaymentRequest(billId: string, input: RecordPaymentInput): Promise<BillPayment> {
  return (await parse(await fetch(`/api/accounting/bills/${encodeURIComponent(billId)}/payments`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) }))).payment as BillPayment;
}
