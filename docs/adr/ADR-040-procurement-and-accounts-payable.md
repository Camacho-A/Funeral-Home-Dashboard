# ADR-040 — Procurement & Accounts Payable (Phase 36)

Status: Accepted (implementation complete; live Wix verification pending explicit authorization)
Date: 2026-08-21
Supersedes/relates: ADR-035 (General Ledger), ADR-039 (Merchandise, Inventory & Commerce)

## Context

Phase 35 (ADR-039) made receiving post **Dr 1300 Inventory Asset / Cr 2100 Inventory Clearing**, where `2100` is a "Goods Received Not Invoiced" (GRNI) holding liability, and stated verbatim that *"a future procurement/AP phase is what would clear `2100` against Cash/AP."* Phase 36 is that phase. It adds the supplier directory, purchase orders, vendor bills, and vendor payments that turn `2100`'s standing accrual into a real, cleared payable — completing the perpetual-inventory loop.

## Decision — the accounting model

The textbook 3-way match, mapped onto the Phase 31 ledger:

| Step | Event | Journal entry | Source type |
|---|---|---|---|
| 1 | **PO created** | **NONE** — a commitment, never a GL transaction | — |
| 2 | **Goods received** | Dr 1300 Inventory Asset / Cr 2100 Inventory Clearing (GRNI) | `inventory_receipt` (Phase 35) |
| 3 | **Vendor bill entered** | Dr 2100 (goods GRNI) / Dr-or-Cr 5120 PPV / Dr {expense} (non-goods) / Cr 2000 Accounts Payable | `bill` |
| 4 | **Bill paid** | Dr 2000 Accounts Payable / Cr Cash (1000 or a bank cash account) | `bill_payment` |

Two new chart-of-accounts rows, rolled out to the live tenant via the proven add-only `backfillMissingStarterAccounts`:
- **`2000 Accounts Payable`** (liability, credit-normal) — the real supplier liability.
- **`5120 Purchase Price Variance`** (expense, debit-normal) — absorbs a justified difference between a receipt's captured cost (the `2100` credit) and the supplier's billed cost. **Unfavorable** (billed > received) debits it; **favorable** (billed < received) credits it — either way the bill entry stays balanced (`domain/ledger/vendorBillPosting.ts`, proven by `vendorBillPosting.test.ts` for both signs). No other accounts are introduced.

The `2100` balance is exactly "received-but-unbilled" and returns to zero when every receipt is billed — the promise ADR-039 made.

## Decision — first-class records & boundaries

- **Bill lines are their own collection** (`vendorBillLineItems`, #78), not embedded JSON — they participate in 3-way matching, partial matching, quantity/price variance, account coding, non-PO expense lines, reporting, and auditability. Goods lines reference the **authoritative receipt movement** (`receiptMovementId`) and the PO line; "how much of a receipt is billed" is **derived** from non-void goods lines, so partial billing and void-reopens-GRNI both fall out for free without mutating the immutable receipt.
- **Three-way matching** compares independent authoritative records — PO line (`quantityOrdered`), receipt (`InventoryMovement`, `quantity`/`unitCost`), and bill line (`quantityBilled`/`billedUnitCostCents`). Partial receipt, partial bill, and partial payment are first-class states (never collapsed to a matched/unmatched boolean). A tolerance/variance is recorded explicitly in `5120`; it never silently rewrites a PO, receipt, or bill amount.
- **PO is non-posting** (structurally enforced: `purchaseOrderService.ts` never calls `createAndPostJournalEntry`).
- **AP never mutates inventory** — receiving stays owned by Phase 35's `inventoryService`; `receiveAgainstPurchaseOrder` delegates to `inventoryService.receiveStock` (which posts the GRNI entry and writes the movement under the per-stock-line lease) and only updates PO-line rollups. `accountsPayableService` never writes an inventory collection, calls `receiveStock`, or fabricates a movement (structurally enforced).
- **Vendor payments are RECORD-ONLY** — Beacon records an externally-executed payment (amount, date, method check/ACH/card/cash/other, external reference, cash account, actor, bill allocation, GL posting, audit) and posts Dr 2000 / Cr Cash. It **never** initiates a bank/ACH/card transfer, and **never** uses the customer-facing `PaymentService`/`PaymentRecord` (structurally enforced — the vendor path is entirely separate from the incoming/customer path).
- **Immutability** — a posted bill or payment is corrected only by **reversal** (void → `generalLedgerService.reverseJournalEntry`), never a destructive edit/delete. `accountsPayableService` never deletes a `journalEntries` row (structurally enforced).
- **Idempotency** — bill/payment posting uses a deterministic `sourceReferenceId` (`ap-bill-{billId}`, `ap-billpay-{paymentId}`) + read-existing-and-skip; duplicate invoices are rejected by an app-enforced per-supplier `(supplierId, billNumber)` check.

## Decision — concurrency (targeted leasing)

Posting-sensitive AP transitions (PO receiving/finalization, bill posting, match finalization, payment recording, void/reversal) run under a **narrow per-aggregate lease** keyed by the specific PO (`po-{org}-{poId}`) or bill (`bill-{org}-{billId}`), **reusing the existing generic lease primitives** (`withInventoryLock`/`commitProtectedWrite` via `aggregateLeaseService`) — **no new lock collection**, and **no organization-wide AP lock** (both structurally enforced). Combined with invariant checks and deterministic idempotency, this substantially closes the practical race.

**Residual Wix limitation (unchanged, disclosed):** Wix Data provides no true OCC/CAS transaction primitive for these workflows. The targeted leases + invariant checks + idempotency/write-claims reduce practical race exposure but **cannot remove the residual final-fence-to-write race** (ADR-026 class). Mitigation: the append-only movement ledger + journal reversibility make any rare drift detectable and correctable. We claim strong, honestly-bounded serialization — never perfect atomicity.

## RBAC

Five keys (catalog 59 → **64**): `procurement.read`, `procurement.manage`, `ap.read`, `ap.manage`, `ap.pay`. **`ap.pay` is a distinct, separately-enforceable policy from `ap.manage`** (segregation of duties: enter vs disburse). Physical receiving remains governed by the existing `inventory.manage`. Tier matrix: administrator/manager all five; accounting `ap.*` + `procurement.read`; funeralDirector/officeStaff `procurement.read/manage` + `ap.read` (can order without being able to pay); arranger none; readOnly `procurement.read` + `ap.read`.

## Wix Data — new collections (74–79)

`suppliers` (74), `purchaseOrders` (75, unique `poNumberKey`), `purchaseOrderLineItems` (76), `vendorBills` (77), `vendorBillLineItems` (78, first-class), `billPayments` (79). Existing-collection extensions: `merchandiseProducts.supplierId` (additive, nullable) and `inventoryMovements.purchaseOrderLineItemId` (additive, nullable). No new lock collection (the Phase-35 `inventoryLocks`/`inventoryWriteClaims` pair is reused as the org's general keyed-lease substrate). See `docs/WIX_DATA_SCHEMA.md`.

## Supplier migration

`MerchandiseProduct.supplierId` is backfilled from the Phase 35 free-text `supplierName` by `supplierMigrationService.ts`: **deterministic** (exact, case-insensitive, org-scoped) matching only, **dry-run first**, **idempotent** apply, **no guessing** — ambiguous names (>1 candidate) are reported and never linked; `supplierName` is preserved as historical snapshot.

## Deferrals (named, not built)

Standalone vendor **credit memos** (a supplier-issued credit not tied to voiding a specific bill) — the **void→reversal** path is the implemented correction/reversal mechanism for v1; credit memos are a named extension. Also: outbound payment-provider integration (ACH/check printing); landed-cost/freight allocation across unit costs; weighted-average/FIFO cost layering; multi-step PO approval / requisitions; recurring/subscription bills; 1099 vendor tax reporting; supplier portal / EDI / punchout; multi-currency; input/use-tax handling; a full AP aging *rich report* beyond the bucketed metric.
