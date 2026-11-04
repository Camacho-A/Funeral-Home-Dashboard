# Overpayments (2026-11)

When a case's order total falls below what the family has already paid
(e.g. a service removed after payment), `CaseOrder.balanceDue` correctly
stops at $0 — but used to say nothing about the money received beyond the
total. SOLIS now identifies that excess and warns staff. It never refunds,
credits or changes a payment, order or settled amount.

## How it is calculated — `domain/billing/caseBalance.ts`

- **Paid** = `succeeded` payment records only (same rule as the existing
  balance). Pending, failed, cancelled and refunded records never count; a
  refund flips its record to `refunded`, so paid is already net of refunds.
  A record seen twice counts once.
- **Owed** = order total − write-offs (never below 0).
- **Balance due** = owed − paid, never below 0.
- **Overpayment** = paid − owed, never below 0. A write-off is never money
  received, so a write-off alone never creates an overpayment.
- The order is the **effective** version (the one billed, also while an
  order change is interrupted).

## Where it shows

- `GET /api/cases/[caseId]/payments/balance` — read-only, `payment.read`
  (same gate as payment history), organization from the session; returns
  `{ balance: { orderTotalCents, paidCents, writeOffCents, balanceDueCents,
  overpaymentCents } | null }`. Additive: no existing response changed.
- **Case Order card** (staff with `payment.read`): status badge "Overpaid",
  a "Credit (overpayment)" row, and the warning *"Payments exceed the order
  total by $X — credit/overpayment to resolve."* Staff with `payment.refund`
  are told how to resolve it (refund the excess from a payment through the
  existing refund flow, or keep it as a credit and note how it was settled);
  others are told to ask an administrator or accounting. No new action.
- Record Payment stays disabled (nothing is owed).

## Unchanged

- `CaseOrder.balanceDue` (stored, never negative) and everything that reads
  it: statements, Receipt of Payment, family portal checkout, AR aging
  (`balanceDue > 0` only), the All Case Data report, the GL. No amount owed
  is ever shown negative.
- Manors' order re-pricing behaviour, payment and refund records, the
  ledger, the Case Information "Payment" summary.

## Options for approval (not built)

1. **"Reviewed" acknowledgement** — staff with a finance permission mark an
   overpayment reviewed with a note. Can be an activity event only (no Wix
   schema change), but needs a new event type and route.
2. **Overpayments report** — list every case whose paid exceeds what is
   owed (needs per-case payment reads across the organization).
3. **Printed documents** — add a "Credit due" line to the Statement and
   Receipt of Payment when overpaid. These are family-facing Manors
   documents, so left unchanged pending approval.
4. **Case Information "Payment" summary** — currently reads "Paid in full ·
   $890.00 paid" for an overpaid case; could add "· $290.00 overpaid".
