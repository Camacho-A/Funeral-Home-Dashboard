import type { Supplier } from '../../types/supplier';
import type { PurchaseOrder } from '../../types/purchaseOrder';
import type { PurchaseOrderLineItem } from '../../types/purchaseOrderLineItem';
import type { VendorBill } from '../../types/vendorBill';
import type { VendorBillLineItem } from '../../types/vendorBillLineItem';
import type { BillPayment } from '../../types/billPayment';

/**
 * Phase 36 (Procurement & Accounts Payable). Mock fixtures for the six new
 * procurement/AP collections. All start EMPTY — no procurement data exists in
 * Solis today (Phase 35 used free-text supplierName, no structured supplier
 * entity). Tests populate these through the services under test, exactly as
 * the Phase 35 merchandise fixtures do. Mutable arrays so mock-mode writes
 * push/splice into them. See docs/adr/ADR-040-procurement-and-accounts-payable.md.
 */
export const supplierFixtures: Supplier[] = [];
export const purchaseOrderFixtures: PurchaseOrder[] = [];
export const purchaseOrderLineItemFixtures: PurchaseOrderLineItem[] = [];
export const vendorBillFixtures: VendorBill[] = [];
export const vendorBillLineItemFixtures: VendorBillLineItem[] = [];
export const billPaymentFixtures: BillPayment[] = [];
