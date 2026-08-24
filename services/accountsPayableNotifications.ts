import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems } from '../lib/wixDataApi';
import { mapWixVendorBillItem, type WixVendorBillItem } from '../lib/wixVendorBillMapper';
import type { VendorBill } from '../types/vendorBill';
import { createNotification } from './notificationService';
import { NOTIFICATION_TYPES } from '../domain/notifications/notificationTypeRegistry';
import { getSupplierById } from './supplierService';
import { vendorBillFixtures } from './__mocks__/procurementFixtures';

/**
 * Phase 36 (Procurement & Accounts Payable). Vendor-bill due/overdue
 * reminders, delivered best-effort via `recipientScope: 'role'` to the
 * accounting role (AP oversight is a role responsibility, never one
 * individual's). Fired from a Vercel Cron sweep, reusing the Phase 33 cron
 * primitive. See docs/adr/ADR-040-procurement-and-accounts-payable.md.
 *
 * `listAllOpenBills` is the ONE org-agnostic query in this module (a cron job
 * has no per-request organization to scope to) — the 4th instance of the
 * documented cross-tenant-sweep exception, contained to this single sweep
 * function (structural-test enforced), never called from a request path.
 */
const DUE_SOON_WINDOW_DAYS = 3;

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function listAllOpenBills(dataAdapterMode: DataAdapterMode): Promise<VendorBill[]> {
  if (dataAdapterMode === 'mock') return vendorBillFixtures.filter((b) => b.status === 'open' || b.status === 'partially_paid');
  // Bounded org-agnostic sweep read (one tenant today; small collection).
  const response = await queryWixDataItems<WixVendorBillItem>('vendorBills', { paging: { limit: 500 } });
  return response.dataItems
    .map((i) => mapWixVendorBillItem(i.data))
    .filter((b): b is VendorBill => b !== null && (b.status === 'open' || b.status === 'partially_paid'));
}

/**
 * Sweeps open vendor bills and fires a due-soon or overdue reminder for each
 * one within the window / past due. Returns the count notified. Idempotent
 * dedup across daily runs is a named limitation (a future `reminderSentAt`
 * marker) — the sweep is meant to run at a coarse cadence.
 */
export async function runBillReminderSweep(nowIso: string, dataAdapterMode: DataAdapterMode): Promise<{ notified: number }> {
  const now = new Date(nowIso).getTime();
  const soonCutoff = now + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const bills = await listAllOpenBills(dataAdapterMode);
  let notified = 0;
  for (const bill of bills) {
    const due = new Date(bill.dueDate).getTime();
    const overdue = due < now;
    const dueSoon = !overdue && due <= soonCutoff;
    if (!overdue && !dueSoon) continue;
    const supplier = await getSupplierById(bill.organizationId, bill.supplierId, dataAdapterMode);
    const ctx = { organizationId: bill.organizationId, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: crypto.randomUUID(), isSystemGenerated: true };
    try {
      await createNotification(
        {
          notificationType: overdue ? NOTIFICATION_TYPES.BILL_OVERDUE.key : NOTIFICATION_TYPES.BILL_DUE_SOON.key,
          entityType: 'vendorBill',
          entityId: bill.id,
          recipientScope: 'role',
          recipientRoleKey: 'accounting',
          tokens: { billNumber: bill.billNumber, supplierName: supplier?.name ?? 'a supplier', amountDisplay: formatCents(bill.totalAmountCents - bill.amountPaidCents), dueDateDisplay: formatDate(bill.dueDate) },
          idFactory: () => crypto.randomUUID(),
        },
        ctx,
        dataAdapterMode,
      );
      notified++;
    } catch (error) {
      console.error('Failed to send bill reminder:', error instanceof Error ? error.message : error);
    }
  }
  return { notified };
}
