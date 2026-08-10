# ADR-035: Financial Management & General Ledger

**Status:** Accepted
**Date:** 2026-08-10

## Context

Beacon has processed real money since Phase 19B (Clover Hosted Checkout) and computed itemized case pricing since Phase 19C (Case Order & Pricing Engine), but had no general ledger. "How much does this case owe" was answered by `CaseOrder.balanceDue` — a mutable field, recomputed live by summing `succeeded` `PaymentRecord`s, never a persisted, auditable transaction history. There was no chart of accounts, no double-entry, no way to answer "how much cash do we actually have," and two RBAC-visible capabilities had sat unbuilt as named, reserved gaps since they were introduced: `payment.refund` (checked in tests, zero route or service implementing an actual refund) and `PaymentRecord`'s staff-actor field (named twice in ADR-034 as "not built here"). This phase closes all of that with a real double-entry ledger integrated with — not duplicating — the existing pricing/payment architecture.

A dedicated planning pass found and resolved eight real architectural conflicts before implementation began (documented below), rather than leaving them to surface mid-build.

## Architectural conflicts found and resolved

1. **"Invoices/invoice items" would have duplicated `CaseOrder`/`CaseOrderLineItem`** (Phase 19C, versioned, append-only, one active version per case), which already function as the invoice model. No new `Invoice`/`InvoiceItem` entities were created — Accounts Receivable is a *reporting* layer over `CaseOrder` + `PaymentRecord` + the new write-off model + the GL.
2. **"No direct balance fields" collides with the already-shipped `CaseOrder.balanceDue`.** That principle governs only the *new* GL accounts this phase introduces (always derived, never stored) — it does not retroactively rewrite `CaseOrder.balanceDue`. The GL's own AR control-account balance is verified to *reconcile with* the sum of open `CaseOrder.balanceDue` values, never unified into one field.
3. **Write-offs would have silently broken that reconciliation.** `CaseOrder.balanceDue` only ever subtracted `succeeded` `PaymentRecord`s — no concept of "satisfied by write-off." Resolved via a new, additive `CaseWriteOff` collection plus `pricingService.ts#getSatisfiedAmountForCase = getPaidAmountForCase + sum(write-offs)`, with `refreshBalanceForCase`'s one call site switched to it; `getPaidAmountForCase` itself is untouched.
4. **Refunds need to credit the right account, depending on whether the cash has already been deposited.** Resolved via a new `PaymentRecord.depositedInBankDepositId: string | null` field (mutable, set once, never un-set) — credit Undeposited Funds if `null`, the linked bank Cash account if set.
5. **AR aging needs "every open order org-wide," an access pattern the existing `caseOrders` collection couldn't serve** (every caller looked up by a known `caseId`). Resolved by adding a `(organizationId, status)` index to the *existing* `caseOrders` collection.
6. **The 5 requested RBAC keys (`accounting.view/manage/post/reconcile/report`) are one coarse resource prefix**, a real, visible deviation from this codebase's `<entity>.<verb>` convention elsewhere. Honored exactly as specified, documented as a deliberate deviation rather than silently departing from convention. Mapped as: `.view` = read-only across chart of accounts/ledger/banking/AR; `.manage` = chart-of-accounts CRUD + write-offs/adjustments; `.post` = post/void a journal entry or transaction (deliberately separate from `.manage`, mirroring the `schedule.edit`/`schedule.cancel` tier-split precedent); `.reconcile` = bank reconciliation specifically; `.report` = the 6 financial reports.
7. **The existing `/reports` page's flat client-side `useMemo` pattern is the wrong shape** for 6 drill-down financial reports that aggregate potentially large ledger history server-side. New reports got their own server-backed routes/pages instead.
8. **Historical data**: Manor's Cremation already had real `succeeded` `PaymentRecord`s with no journal entries behind them. Resolved via a one-time, dry-run-then-apply backfill migration (`services/financialBackfillMigrationService.ts`, mirroring `staffProfileMigrationService.ts`'s exact two-phase shape) that generates opening journal entries for existing payments. Any row whose case can no longer be resolved books against a named, disclosed "Legacy Opening Balance" fallback account (3010) rather than being silently skipped or mis-booked against a receivable that may no longer be real.

## Chart of accounts and numbering

```ts
export type LedgerAccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type LedgerAccountNormalBalance = 'debit' | 'credit';
```

`LedgerAccount.accountNumber` (display) is paired with `accountNumberKey` (`{organizationId}:{accountNumber}`, the real Wix unique index) — the same composed-key split `JournalEntry.entryNumber`/`entryNumberKey` uses. `accountType`/`accountNumber` are immutable once created; `isSystemAccount` accounts can never be deactivated.

Starter chart, seeded per-organization (never a shared cross-org template row, mirroring `starterServiceCatalog.ts`'s own pattern): `1000` Cash-Operating, `1100` Undeposited Funds, `1200` Accounts Receivable, `3000` Retained Earnings, **`3010` Legacy Opening Balance** (equity — added mid-implementation as the backfill migration's disclosed fallback counter-account, not part of the original plan's starter list), `4000` Service Revenue, `5000` Bad Debt Expense, `5010` Bank Fees Expense (reserved, no automatic posting exists yet). `1010`+ (one Cash-Bank account per `BankAccount`) is deliberately not seeded — an operator creates that ledger account explicitly, then links a `BankAccount` to it via `bankingService.ts#createBankAccount`, which validates the target is asset-type but does not create it.

## General ledger and posting lifecycle

Every system-generated entry (`payment`/`refund`/`write_off`/`adjustment`/`deposit`/`transfer`/`reversal`/`opening_balance`) is created already `posted` — derived from an already-decided real-world event, so an intermediate draft adds no review value. Only `sourceType: 'manual'` entries go `draft` → `posted`, letting a preparer compose a multi-line entry and review before posting. The moment status flips to `posted`, the entry and every line are permanently immutable.

Reversing entries never mutate the original: `reversesEntryId` lives only on the *new* reversing entry (forward reference only) — "has X been reversed" is always a query, never a field written back onto the original. `reverseJournalEntry` rejects reversing an already-reversed entry and posts a mirror-flipped entry immediately.

`domain/ledger/balancing.ts#assertJournalEntryBalances` is called before any write is attempted: throws unless ≥2 lines, every amount is a positive integer, and `sum(debits) === sum(credits)`. Entry numbers are generated by querying the org's highest existing `entryNumber`, incrementing, and retrying on a 409 conflict (up to 5 attempts) against the unique `entryNumberKey` index — the same atomic-insert-conflict primitive `paymentRecords.idempotencyKey` already relies on. Since every balance is derived (summed at read time, never stored), there is no concurrent-write balance-corruption risk.

No caching, ever — mirrors `permissionService.ts`'s Phase-22-incident-derived rule; every balance is summed fresh on every call.

## Financial transactions and account pairings

| Transaction | Debit | Credit | Caller |
|---|---|---|---|
| Payment posting | Undeposited Funds (1100) | Accounts Receivable (1200) | `paymentWorkflow.markCasePaidIfVerified`, via its new optional `financialPosting` param |
| Refund | Accounts Receivable (1200) | Undeposited Funds **or** linked Bank Cash (branches on `depositedInBankDepositId`) | `financialTransactionService.postRefundTransaction` |
| Write-off | Bad Debt Expense (5000) | Accounts Receivable (1200) | `postWriteOffTransaction`, gated `accounting.manage` |
| Adjustment | staff-selected account | staff-selected account | `postAdjustmentTransaction`, gated `accounting.manage` |
| Deposit | Cash-Bank (101x) | Undeposited Funds (1100) | `postDepositTransaction`, gated `accounting.post` |
| Transfer | destination account | source account | `postTransferTransaction`, gated `accounting.post` |

`postRefundTransaction` calls the widened `PaymentProvider.refundPayment` **before** posting any journal entry, so a provider-side failure never leaves an unjournaled refund; it resolves the credit account via `depositedInBankDepositId` → `BankDeposit.bankAccountId` → `BankAccount.ledgerAccountId`. It flips `PaymentRecord.status: 'succeeded' → 'refunded'` — an already-legitimate status transition since Phase 19B, not a violation of ledger immutability — and reuses the pre-existing, previously-reserved `ACTIVITY_EVENT_TYPES.PAYMENT_REFUNDED` builder (`recordPaymentRefunded`, category `'payments'`) rather than introducing a competing new event type; this gives that reserved type its first real emitter.

`postDepositTransaction` generates the deposit's id via `idFactory()` **before** creating the journal entry, so the entry's `sourceReferenceId` and the deposit row's own `id` are the same value from the start — a real bug caught and fixed during implementation (the entry initially had no `sourceReferenceId`, silently breaking the Transaction Register's deposit-description enrichment).

## Accounts receivable

Confirms conflict #1 — `CaseOrder`/`CaseOrderLineItem` remain the invoice model; AR is a reporting layer. Aging anchors on the case's **first `CaseOrder` version's `createdAt`** (`version === 1`), never the current (possibly-superseded) version's own date, so a routine price edit via `recalculateOrder` never resets an overdue balance's age to zero. `getArAgingReport` cross-checks `sum(rows.balanceDue)` against the GL's own derived AR balance and returns `reconciles: boolean` — surfaced to the UI as a badge, never silently hidden.

## Banking and reconciliation

The least-precedented part of this phase — no prior Beacon feature imports/reconciles external data.

**Bank reconciliation `bookBalanceAtStart`**: must be the last **completed** reconciliation's own `statementEndingBalance` (0 for a first-ever reconciliation) — **not** the account's current live balance. This was a real bug introduced during implementation and caught via a failing test: using the live balance double-counts a transaction posted before reconciliation started but also matched within that same pass. Fixed by redefining `bookBalanceAtStart` per standard bank-reconciliation practice.

**Auto-match algorithm**: for each `unmatched` `BankStatementLine`, candidates are `JournalEntryLine`s on the linked ledger account where direction/amount match exactly (positive statement amount = deposit = debit line; negative = withdrawal = credit line) and the parent entry's `entryDate` is within ±3 days, excluding entries already matched elsewhere. Exactly one candidate auto-matches; zero or multiple are left `unmatched` for a human (`manuallyMatchStatementLine`/`excludeStatementLine`, the latter for bank-only events like fees with no corresponding Beacon entry yet — a named, disclosed gap requiring a separate manual adjustment before reconciliation balances). `completeReconciliation` validates `bookBalanceAtStart + sum(matched amounts) === statementEndingBalance` and returns the variance rather than silently completing if it doesn't. "Reconciled" is an audit marker only — `getAccountBalance` remains the sole source of truth for a bank account's real balance.

`POST /api/accounting/banking/statement-imports` automatically runs `runAutoMatch` immediately after import — filling a real gap the original plan's route list left open (no dedicated "run auto-match" endpoint was ever named) without inventing an unlisted route.

## Financial reports

| Report | Derivation |
|---|---|
| Trial Balance | 100% derived from `journalEntryLines` |
| General Ledger (detail) | 100% derived, filtered by account/date |
| Balance Sheet | 100% derived; folds Net Income (Revenue − Expense) into Equity, since this phase has no formal period-close (disclosed, deferred) |
| Profit & Loss | 100% derived; sums in-range posted lines directly rather than reusing `getAccountBalance`, which has no lower-bound date filter |
| AR Aging | Not pure-GL — `caseOrders` + case v1 anchor + `caseWriteOffs`, cross-checked against the GL's AR balance |
| Transaction Register | Mostly derived; enriched with a human-readable description resolved from the originating `PaymentRecord`/`BankDeposit` |

`displayAmount()` flips the raw debit-positive `getAccountBalance` figure for credit-normal account types (liability/equity/revenue) so reports show intuitively-positive numbers. Trial Balance/Balance Sheet/P&L re-scan all-time journal lines at request time — architecturally clean (zero concurrent-write corruption risk) but a real future scaling cost at higher transaction volume, named here and in Deferred rather than solved now. The `COUNT` endpoint is never used for any report total, per the Phase 28 finding that it can return a stale/inflated total.

## Service architecture

- **`services/chartOfAccountsService.ts`**: account CRUD + `seedChartOfAccounts`, wired into `organizationProvisioningService.ts`'s onboarding sequence right after `seedServiceCatalog`.
- **`services/generalLedgerService.ts`**: posting lifecycle, entry-number generation/retry, reversal, `getAccountBalance` (the one derived-balance primitive every report reuses), `getTrialBalance` (a simpler, raw per-account shape — **not** the same function as `financialReportsService.ts`'s richer `getTrialBalance`; the two share a name but live in different modules with different return shapes, a naming collision worth knowing about if extending either).
- **`services/financialTransactionService.ts`**: one function per transaction type, each a thin caller into `generalLedgerService.createAndPostJournalEntry` owning its own account-selection logic.
- **`services/bankingService.ts`**: accounts, deposits *(writer moved — see below)*, statement import, auto-match, manual match/exclude, reconciliation start/complete.
- **`services/financialReportsService.ts`**: all 6 reports.
- **`services/financialBackfillMigrationService.ts`**: the historical backfill migration (see "Live Wix verification").
- **`domain/ledger/balancing.ts`** / **`domain/ledger/agingBuckets.ts`**: pure functions, unit-tested standalone.

**Collection-writer note**: `bankDeposits` is written by `financialTransactionService.ts` (via `postDepositTransaction`), not `bankingService.ts` — `bankingService.ts` owns account management/statement import/reconciliation but never deposit creation, since a deposit is a financial transaction with its own Dr/Cr posting, not a banking-administration action. `caseWriteOffs` is likewise written by `financialTransactionService.ts`, not `chartOfAccountsService.ts`. Both are enforced by `services/financialStructuralBoundaries.test.ts`'s only-writer-per-collection tests.

`lib/paymentProvider.ts` was widened additively with `refundPayment(params): Promise<RefundResult>`; `cloverProvider.ts` implements it via Clover's real refund API; mock-mode returns a synthesized `{providerRefundId: 'mock-refund-{id}'}` without calling Clover, mirroring `initiateCheckout`'s own mock-mode branch.

`pricingService.ts` gained exactly one new function (`getSatisfiedAmountForCase`) and one modified call site (`refreshBalanceForCase`); `getPaidAmountForCase` and every other existing function are untouched. `financialTransactionService.ts` imports from `pricingService.ts` (for `refreshBalanceForCase`), never the reverse — `pricingService.ts` reads `caseWriteOffs` directly via a private helper rather than importing from `financialTransactionService.ts`, keeping the dependency one-directional and avoiding a circular import.

## RBAC

Catalog **45 → 50**. New keys: `accounting.view`, `accounting.manage`, `accounting.post`, `accounting.reconcile`, `accounting.report` (see conflict #6 for the coarse-vs-fine-grained rationale). `administrator` and the existing `accounting` role (whose entire reason for existing is this phase) get all 5; every other default role (`manager`, `funeralDirector`, `arranger`, `officeStaff`, `readOnly`) gets none by default — financial data is more sensitive than general case data, adjustable later via a cloned custom role.

## Security model

Full tenant isolation (every new collection requires `organizationId`, every service filters by it); no caching of any financial permission resolution; posted `JournalEntry`/`JournalEntryLine` rows are never updated or deleted, corrections are always a new reversing entry; every actor-attribution field is StaffProfile-space (`postedByStaffProfileId`, etc.), never Identity-space directly, per ADR-034's hard layering invariant. No direct Wix access from routes/components/hooks for the financial surface — confirmed via `services/financialStructuralBoundaries.test.ts`'s dedicated no-direct-Wix boundary test, mirroring `portalStructuralBoundaries.test.ts`'s exact pattern.

## Live Wix verification

Live verification was staged in two passes with an explicit user checkpoint between them, given the scope of touching a real tenant's data.

**Pass 1 (dry run only)**: created just the two collections a dry run of the backfill migration actually needs (`chartOfAccounts`, `journalEntries`, with their indexes, confirmed `ACTIVE`), seeded the real chart of accounts for Manor's Cremation (`isNew: true`, 8 accounts), then read the live tenant's real cases/payments (read-only) and ran `backfillOpeningJournalEntries` in dry-run mode. **Finding, not a bug**: Manor's Cremation currently has exactly 1 live case and 0 payment records — there is no historical `succeeded` payment data yet to backfill. The migration correctly reported an empty result rather than erroring.

**Pass 2 (full verification, on explicit user approval)**: created the remaining 7 collections (`journalEntryLines`, `bankAccounts`, `bankDeposits`, `bankStatementImports`, `bankStatementLines`, `bankReconciliations`, `caseWriteOffs`) and their indexes, all confirmed `ACTIVE`; added `caseOrders`' new `(organizationId, status)` index (the field already existed, so this required only an index call, no schema `PUT`); extended `paymentRecords` live with `initiatedByStaffProfileId`/`depositedInBankDepositId` via the established "resend the full field list" `PUT` mechanism (revision 2 → 3).

Exercised against real Wix data via disposable rows, all deleted afterward with a final residual check confirming zero leftover: a disposable payment posting (`postPaymentTransaction`) — confirmed the exact expected $123.45 debit/credit deltas on Undeposited Funds/Accounts Receivable; a reversal of that entry (`reverseJournalEntry`) — confirmed the original entry's status/lines were untouched and both accounts' net balances returned to exactly their pre-posting baseline; a full deposit → bank-statement-import → auto-match → reconciliation round trip — one disposable `BankAccount` linked to a disposable Cash-type `LedgerAccount` (account `1099`), one disposable deposit, one matching statement line, `runAutoMatch` correctly matched it (`matchedCount: 1`), and `completeReconciliation` returned `variance: 0, completed: true`. A separate check confirmed `financialReportsService.getTrialBalance` correctly reflects real posted activity against live Wix data ($99.99 balanced, not just structurally present).

One process note: an early verification script imported `getTrialBalance` from `generalLedgerService.ts` instead of `financialReportsService.ts` — the two modules export differently-shaped functions with the same name (see "Service architecture" above) — producing a false-positive "balances: true" from two `undefined` values. Caught before being reported as a finding; corrected by importing from the right module and re-verified with real non-trivial numbers.

Every disposable row (2 payments, 3 journal entries + their lines, 1 bank account, 1 test ledger account, 1 bank deposit, 1 statement import + line, 1 reconciliation) was deleted; a final residual-check query across all 9 new collections plus `paymentRecords` confirmed zero leftover rows — only the 8 real, permanent starter chart-of-accounts rows remain live.

## Permissions

Five new keys (see "RBAC" above). Total permission count moves from 45 to **50**.

## Deferred

- **Period-close / closing entries** — Balance Sheet folds Net Income into Equity as a standing simplification rather than a formal period-close feature; named, not solved.
- **True scheduled overdue-payment notifications** — Beacon has no background/scheduled-job infrastructure anywhere; `INVOICE_OVERDUE` can only be evaluated on-demand (e.g., when the AR Aging report is viewed), never on a real nightly schedule.
- **Report read-time cost at scale** — Trial Balance/Balance Sheet/P&L re-scan all-time history; acceptable at this tenant's current volume, a named future scaling concern, not solved now.
- **RBAC granularity** — the 5 coarse `accounting.*` keys mean an org can't, out of the box, grant "view reports only" without also seeing the full chart of accounts/banking; mitigated only by cloning a custom role later.
- **Re-reversal of an already-reversed entry** — `reverseJournalEntry` rejects this outright; a named, deferred edge case, not silently allowed.
- **Accounts Payable / liabilities beyond the reserved 2000s numbering block** — no AP feature exists; the numbering range is reserved, nothing more.
- **Multi-currency** — every amount is assumed to be the organization's single operating currency.
- **Auto-match false positives** — ±3-day/exact-amount matching could match two genuinely unrelated same-amount transactions within the window; no fuzzy-text-matching primitive exists to add a third signal.
