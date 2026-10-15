import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { queryAllWixDataItems } from '../lib/wixDataApi';
import { isOrganizationAllowedInDeployment } from '../lib/auth/deploymentOrganizations';
import { deploymentOrganizationWixFilter, retainDeploymentRecords } from './scheduledJobs/sweepSupport';
import { mapWixVendorBillItem, type WixVendorBillItem } from '../lib/wixVendorBillMapper';
import type { VendorBill } from '../types/vendorBill';
import { createNotification, getNotification } from './notificationService';
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
 * `listAllOpenBills` is the ONE cross-organization query in this module (a
 * cron job has no per-request organization to scope to), contained to this
 * single sweep function, never called from a request path.
 *
 * Scheduled-job isolation (2026-10, docs/SCHEDULED_JOBS.md):
 *  - the query is scoped to this deployment's organizations
 *    (`DEPLOYMENT_ORGANIZATION_IDS`) and every bill is re-checked with
 *    `isOrganizationAllowedInDeployment` before anything is sent;
 *  - the status filter is pushed into the query and the read is fully
 *    paginated (previously one unfiltered 500-row page, filtered in app code);
 *  - idempotent per (organization, bill, UTC day): the reminder notification
 *    gets a deterministic id, so a second run the same day finds it and
 *    skips, and two concurrent runs collide on the Wix item `_id` (insert of
 *    an existing `_id` is rejected) — no schema change, no new collection.
 */
const DUE_SOON_WINDOW_DAYS = 3;
const OPEN_BILL_STATUSES = ['open', 'partially_paid'] as const;

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Deterministic dedupe key: one bill reminder per (organization, bill, UTC reminder date). */
export function billReminderNotificationId(organizationId: string, billId: string, nowIso: string): string {
  return `bill-reminder-${organizationId}-${billId}-${formatDate(nowIso)}`;
}

async function listAllOpenBills(dataAdapterMode: DataAdapterMode): Promise<VendorBill[]> {
  let bills: VendorBill[];
  if (dataAdapterMode === 'mock') {
    bills = vendorBillFixtures.filter((b) => (OPEN_BILL_STATUSES as readonly string[]).includes(b.status));
  } else {
    const orgFilter = deploymentOrganizationWixFilter();
    // One single-value query per open status (no reliance on a multi-value
    // status operator), each paginated to completion.
    const pages = await Promise.all(
      OPEN_BILL_STATUSES.map((status) => queryAllWixDataItems<WixVendorBillItem>('vendorBills', { ...orgFilter, status })),
    );
    bills = pages
      .flat()
      .map((i) => mapWixVendorBillItem(i.data))
      .filter((b): b is VendorBill => b !== null && (OPEN_BILL_STATUSES as readonly string[]).includes(b.status));
  }
  return retainDeploymentRecords('bill-reminders', bills, (b) => b.organizationId);
}

/**
 * Sweeps open vendor bills and fires a due-soon or overdue reminder for each
 * one within the window / past due. Returns the count notified (a bill
 * already reminded today is not counted again).
 */
export async function runBillReminderSweep(nowIso: string, dataAdapterMode: DataAdapterMode): Promise<{ notified: number }> {
  const now = new Date(nowIso).getTime();
  const soonCutoff = now + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const bills = await listAllOpenBills(dataAdapterMode);
  let notified = 0;
  for (const bill of bills) {
    // Defense in depth — re-checked immediately before acting.
    if (!isOrganizationAllowedInDeployment(bill.organizationId)) continue;
    const due = new Date(bill.dueDate).getTime();
    const overdue = due < now;
    const dueSoon = !overdue && due <= soonCutoff;
    if (!overdue && !dueSoon) continue;

    const notificationId = billReminderNotificationId(bill.organizationId, bill.id, nowIso);
    try {
      if (await getNotification(bill.organizationId, notificationId, dataAdapterMode)) continue; // already reminded today
    } catch (error) {
      console.error('Failed to check bill reminder dedupe key; skipping this bill this run:', error instanceof Error ? error.message : error);
      continue;
    }

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
          // Deterministic — the dedupe key above. A concurrent run that
          // already inserted this id makes this insert fail before any
          // recipient is resolved or any channel is sent.
          idFactory: () => notificationId,
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
