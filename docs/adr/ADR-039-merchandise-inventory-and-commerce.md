# ADR-039: Merchandise, Inventory & Commerce

**Status:** Accepted
**Date:** 2026-08-19

## Context

Phase 19C (ADR-023) built `CaseOrder`/`CaseOrderLineItem` and a pricing engine for **services**; Phase 31 (ADR-035) built the general ledger; Phase 32 (ADR-036) corrected revenue recognition to a real accrual model. None of it modeled **physical goods** — urns, caskets, keepsakes, memorial jewelry, vaults, cremation containers, flowers, clothing, stationery, register books. Phase 35 adds merchandise and inventory, integrating into the existing CaseOrder/pricing/ledger rather than creating a competing commerce or accounting truth.

Three decisions were approved before implementation:

1. **CaseOrder generalization** via a `lineKind` discriminator + structured `OrderSelections` (inputs, not a second source of truth); historical line-item snapshots and backward compatibility preserved.
2. **Full merchandise accounting now** — real Merchandise Revenue + COGS + Inventory Asset (not a revenue-only model), using an Inventory Clearing account only where receiving genuinely requires it, without fabricating an AP system.
3. **Per-product/variant + location + organization inventory locking**, not an organization-wide lock, with the residual Wix atomicity limitation documented honestly.

## Decision 1 — CaseOrder generalization

`CaseOrderLineItem` gains **`lineKind: 'service' | 'merchandise' | 'surcharge' | 'adjustment' | 'tax' | 'discount'`** (added live via `create-field`; the mapper defaults a missing value to `'service'`, so every pre-Phase-35 order and all service-only orders remain byte-for-byte compatible). `'service'` and `'merchandise'` are actively populated this phase; the other four are stable reserved kinds (tax/discount calculation is deferred; weight-surcharge lines stay `'service'` to preserve historical immutability).

The pure pricing engine (`domain/pricing/calculateOrder.ts`) is generalized: `calculateOrderTotals(catalog, selections)` stays the service-only entry point (unchanged, still shared with the browser preview), and a new `calculateOrderTotalsWithMerchandise(catalog, products, orderSelections)` combines service lines with merchandise lines. `OrderSelections = { services: ServiceSelections (unchanged), merchandise: MerchandiseSelection[] }` is reconstructed from persisted line items on every recalculation (`selectionsFromLineItems` + `merchandiseSelectionsFromLineItems`), so a service-only edit carries merchandise forward unchanged and vice versa — the selections are calculation inputs, never stored state. Merchandise lines snapshot `retailPrice`/`name` and carry `{ productId, sku, locationId }` in the existing `metadata` map (historical stability; a later catalog reprice/rename/archive never rewrites a historical order).

CaseOrder remains the single authoritative order — one `total`, one `balanceDue`, one family-facing statement.

## Decision 2 — Full merchandise accounting

Five new ledger accounts (seeded for new tenants + an add-only backfill for the existing tenant, since `seedChartOfAccounts` returns early once a chart exists):

| # | Name | Type |
|---|---|---|
| 1300 | Inventory Asset | asset |
| 2100 | Inventory Clearing | liability |
| 4100 | Merchandise Revenue | revenue |
| 5100 | Cost of Goods Sold | expense |
| 5110 | Inventory Shrinkage Expense | expense |

Postings (all through `generalLedgerService.createAndPostJournalEntry` only — never a parallel calculation):

| Event | Entry | Source type |
|---|---|---|
| Receiving | Dr Inventory Asset 1300 / Cr Inventory Clearing 2100 | `inventory_receipt` |
| Merchandise on order (accrual, delta) | Dr AR 1200 / Cr Merchandise Revenue 4100 (service delta still Cr 4000, same entry) | `revenue_recognition` |
| Fulfillment | Dr COGS 5100 / Cr Inventory Asset 1300 | `cogs` |
| Return–restock | reverse the fulfillment COGS + reprice order down | `reversal` + `revenue_recognition` |
| Damage / shrinkage / write-off | Dr Inventory Shrinkage 5110 / Cr Inventory Asset 1300 | `inventory_adjustment` |

**Why Inventory Clearing is required and is NOT an AP workflow.** Double-entry makes the receiving credit unavoidable: to debit Inventory Asset (so COGS can later credit it without driving 1300 negative), something must be credited, and the economically honest credit for goods-received-but-not-yet-modeled-as-paid is a liability, not equity or cash. Phase 35 therefore adds exactly **one holding account** (`2100`, "Goods Received Not Invoiced") and nothing else on the payable side — no vendor entities, no bills, no PO matching, no payment terms. A future procurement/AP phase is what would clear `2100` against Cash/AP. Crediting Equity was evaluated and rejected (it misrepresents received-on-credit goods as owner-contributed capital).

**Revenue split.** `pricingService.postRevenueRecognition` was generalized to take a signed `serviceDelta` and `merchandiseDelta` and emit one balanced entry: Dr/Cr AR for the net, Cr/Dr Service Revenue (4000) for the service delta, Cr/Dr Merchandise Revenue (4100) for the merchandise delta. Delta-based (never re-recognizes booked revenue); a service-only order (`merchandiseDelta === 0`) posts an entry identical to the pre-Phase-35 behaviour, so nothing regressed. Merchandise revenue accrues at order-add (consistent with service revenue's own accrual model); COGS matches at fulfillment (a disclosed, standard timing choice).

**Idempotency.** The ledger has no auto-idempotency, so every merchandise posting carries a deterministic `sourceReferenceId` (`merch-recv-…`, `merch-cogs-{reservationId}`, `merch-adj-…`) and `inventoryService` reads existing entries and skips before posting — no double-post of COGS/receipt/adjustment. Posted entries stay immutable; corrections are reversing entries.

New `JournalEntrySourceType` values (`inventory_receipt`, `cogs`, `inventory_adjustment`) were added to **both** the union and `lib/wixJournalEntryMapper.ts`'s `VALID_SOURCE_TYPES` (a Phase 32/33 lesson — a missing allowlist entry silently drops entries from all reads).

## Decision 3 — Inventory model + per-stock-line concurrency

**Authoritative, append-only movement ledger.** `inventoryMovements` is immutable and append-only; on-hand for a (product, location) is always Σ(movement.quantity). Reservations are NOT movements (a soft hold doesn't change on-hand); only a `sale` movement at fulfillment reduces stock. `inventoryReservations` is mutable (deterministic id `${org}-${case}-${product}-${location}` → re-selecting a product on a case is an idempotent quantity re-sync, never a second reservation). `inventoryBalances` is a derived, rebuildable snapshot recomputed from source inside the lease after every mutation — so it can never drift within a lease, and the reconcile routine is literally the same recompute (drift detection + repair).

**Per-stock-line lease + write-claim.** `inventoryLockService` is the exact proven Phase 22 construction (lease + fencing token + write-claim over Wix Data's one atomic primitive, unique-`_id` insert-conflict), generalized from a per-organization key to the stock-line key `${organizationId}-${locationId}-${productId}`. Concurrent operations on different stock lines never contend; only same-(org, location, product) operations serialize (reserve/release/fulfill/return/receive/adjust). Transfers acquire both stock-line locks in canonical sorted order to avoid deadlock.

**Honest residual race.** Reserving "only if available" is a read-check-write, and Wix Data offers no conditional write / CAS (confirmed empirically, ADR-026). The lease + write-claim closes the race for every realistic scenario, but a single un-closeable gap remains between the final fence-check and the write dispatch — now scoped to one stock line, and mitigated by the append-only ledger making any rare drift detectable and correctable via reconcile. We claim strong, honestly-bounded serialization, never perfect atomicity.

## Deferred (explicitly out of scope, extension points reserved)

Structured product variants (each sellable SKU is its own product this phase; `parentProductId` reserved, always null); sales-tax calculation/collection (`taxable` captured, no rate config, no computed tax — `taxTotal` stays 0); supplier directory (supplier is free-text on products/receipts); purchase orders / procurement / accounts payable (Inventory Clearing stands in); barcode-scanner hardware (`sku` is a first-class field); public ecommerce storefront; Wix Stores / Shopify / Amazon / marketplace / EDI; shipping-carrier / delivery-route logistics; moving-average cost (product `cost` snapshot used); per-SKU-only lease granularity refinements beyond the shipped design.

## RBAC

Five new keys (54 → **59**), following the accounting-block coarse-key precedent: `merchandise.read`/`.manage` (catalog), `inventory.read`/`.manage` (receive/reserve/fulfill/transfer/restock-return), `inventory.adjust` (audited damage/shrinkage/write-off/correction). Selecting merchandise onto a case reuses the existing `caseOrder.update`. Tiers: administrator/manager all five; funeralDirector/officeStaff read + manage; arranger/accounting/readOnly read only; adjust is administrator/manager only. `authorizationPolicyService` gained one-line `canReadMerchandise`/`canManageMerchandise`/`canReadInventory`/`canManageInventory`/`canAdjustInventory` wrappers. Adding the keys requires a targeted live `rolePermissions` re-seed (a full seed hits HTTP 429), per Phase 31/32's established pattern.

## Family Portal

A new family-safe DTO (`domain/portal/portalMerchandiseView.ts`, `services/portal/portalMerchandiseService.ts`) exposes only the merchandise on a family's own case — name/quantity/price — through the existing `payment.read` capability. Product **cost/margin, supplier, and stock levels are never exposed** (a structural test asserts no `/api/family/*` merchandise surface references `cost` in code). No storefront, no browsing of internal inventory.

## Wix Data — new collections (68–72)

| # | Collection | Indexes |
|---|---|---|
| 68 | `merchandiseProducts` | `(organizationId, category)`, `(organizationId, isActive)`, `(organizationId, sku)` |
| 69 | `inventoryMovements` (append-only) | `(organizationId, productId, locationId)`, `(organizationId, caseId)`, `(organizationId, movementType)` |
| 70 | `inventoryBalances` (derived) | `_id = {org}-{loc}-{product}`; `(organizationId, locationId)`, `(organizationId, productId)` |
| 71 | `inventoryReservations` | `(organizationId, caseId)`, `(organizationId, status)`, `(organizationId, productId, locationId)` |
| 72 | `inventoryLocks` | `_id = lockKey` |

A sixth collection, `inventoryWriteClaims` (`_id = lockKey`), backs the write-claim. Plus rows added to existing `chartOfAccounts` (1300/2100/4100/5100/5110) and a field-add to `caseOrderLineItems` (`lineKind`). SKU uniqueness is application-enforced per organization (Wix's single-field unique index is not org-scoped).

## Migration

Manor's Cremation's 5-item `serviceCatalog` is **services, not merchandise** — untouched, not migrated. **No merchandise data exists anywhere, so no historical merchandise migration is required.** The only permanent live changes are: the five new ledger accounts (add-only backfill), the six new collections, and the `caseOrderLineItems.lineKind` field (historical rows default to `'service'`).

## Testing

Unit + integration coverage lives in: `domain/merchandise/*` (category registry, inventory math), `domain/pricing/calculateOrderMerchandise.test.ts` (merchandise pricing + reverse-maps + revenue split math), `services/pricingServiceMerchandise.test.ts` (order recalc preserves the untouched dimension + revenue split + historical immutability), `services/merchandiseService.test.ts` (catalog CRUD, SKU uniqueness, tenant isolation), `services/inventoryLockService.test.ts` (per-stock-line serialization + parallelism across lines + write-claim), `services/inventoryService.test.ts` (receive/reserve/oversell/**concurrent-oversell**/fulfill+COGS/return-restock reversal/shrinkage/transfer/reconcile-drift, all with balanced journal entries), `services/merchandiseCommerceFlow.test.ts` (full reserve → order recalc → fulfill flow), `services/merchandiseReportingService.test.ts`, and `services/merchandiseStructuralBoundaries.test.ts` (sole-writer, sole-emitter, ledger-only accounting, no direct Wix in routes/UI, layering invariant, and the family-DTO-no-cost security invariant).

## Live Wix verification

Two-pass, accounting-safe, on explicit approval (matching Phase 31's discipline): create collections 68–73 + indexes; backfill the five ledger accounts; add the `lineKind` field; then a disposable product → receive → reserve to a disposable case → fulfill → return round trip, verifying merchandise revenue (4100), COGS (5100), and inventory-asset (1300) postings against real data. **Cleanup deletes disposable operational rows but never deletes posted journal entries — reversals only** (accounting immutability); if cleanup ever conflicts with ledger immutability, stop and report.

## Risks and known limitations

- No hard inventory atomicity in Wix Data — per-stock-line lease + append-only ledger + reconcile; documented residual gap (ADR-026 class).
- Merchandise revenue accrues at order-add, COGS at fulfillment — a disclosed timing choice, consistent with the existing service-revenue accrual model.
- Inventory Clearing (2100) is a deliberate stand-in for an absent AP feature; a future procurement/AP phase clears it.
- `BLOB_READ_WRITE_TOKEN` is unavailable in this environment (same gap as Phase 25/26), so product-image bytes are not live-verifiable; the image reference model uses the `DocumentStorageProvider` interface and degrades gracefully.
- Adding RBAC keys requires a targeted live `rolePermissions` re-seed; new ledger source types require dual-list (union + mapper) updates.
