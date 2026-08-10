/**
 * Phase 31 (Financial Management & General Ledger). Records that part of a
 * case's balance was forgiven rather than paid — the piece
 * `CaseOrder.balanceDue` has no concept of on its own, since it only ever
 * subtracts `succeeded` `PaymentRecord`s (see types/caseOrder.ts). Without
 * this, a write-off would reduce the general ledger's Accounts Receivable
 * balance while `CaseOrder.balanceDue` kept demanding money that's no
 * longer expected — the two would silently and permanently diverge. See
 * services/pricingService.ts#getSatisfiedAmountForCase (which sums this
 * alongside `getPaidAmountForCase`) and
 * docs/adr/ADR-035-financial-management-and-general-ledger.md.
 *
 * Append-only, immutable, like every other financial record this phase
 * introduces — reversing a write-off (should that ever be needed) is a
 * new `JournalEntry` with `sourceType: 'reversal'`, never an edit or
 * deletion of this row.
 */
export type CaseWriteOff = {
  id: string;
  organizationId: string;
  caseId: string;
  /** Integer cents. */
  amount: number;
  /** -> JournalEntry.id — the Dr Bad Debt Expense / Cr Accounts Receivable
      entry this write-off posted. */
  journalEntryId: string;
  reason: string;
  /** StaffProfile-space — see types/journalEntry.ts's own comment on why. */
  performedByStaffProfileId: string | null;
  createdAt: string;
};
