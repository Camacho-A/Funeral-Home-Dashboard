# ADR-041 — Product Variants (Phase 37)

Status: Accepted · Builds on ADR-039 (Merchandise & Inventory) and ADR-040 (Procurement & AP).

## Context

Phase 35 shipped merchandise as flat products (one SKU = one sellable unit) and reserved `MerchandiseProduct.parentProductId` for a future variant model. Phase 37 delivers first-class **product variants**.

> **Sales tax: not currently required / out of scope.** An initial Phase 37 draft also explored configurable sales tax; that was removed before commit per a business-requirements correction. **Beacon does not calculate, collect, accrue, report, or remit sales tax.** `CaseOrder.taxTotal` and the `'tax'` `CaseOrderLineKind` remain **reserved and always-zero / never-emitted** (as in Phase 35), so a future feature could be additive, but no tax behavior exists.

## Decisions

### 1. Variants are a dedicated first-class collection, threaded by optional `variantId`
A variant is a row in a new `merchandiseProductVariants` collection keyed to its parent `MerchandiseProduct`. The canonical inventory stock key becomes `(organizationId, locationId, productId, variantId?)`, backward-compatibly: a **null `variantId` reproduces the exact Phase 35 key** at every site (balance id, `stockLineLockKey`, `reservationId`, the `receivingMovementId` sha256 pre-image), so all pre-Phase-37 history is unchanged. Per-stock-line locking includes `variantId`, so reserving/receiving one variant never locks a sibling.

### 2. Strict product/variant bifurcation (`hasVariants`)
`MerchandiseProduct.hasVariants` is a **server-maintained** mode flag (clients never toggle it — set only via `merchandiseVariantService`). `false` ⇒ original product-level behavior; `true` ⇒ the parent is **not** independently sellable/stockable and every inventory/order/procurement action requires an active `variantId`. **No mixed product-level + variant-level stock** for one product. Converting to variant mode fails closed if product-level stock/reservations/open PO lines exist; archival fails closed while active variants, variant stock, reservations, or open PO lines remain (never blind cascade). Variant→non-variant conversion is out of scope.

### 3. B2 nullable-override economics inheritance
A variant carries nullable `retailPriceOverride` / `costOverride` / `taxableOverride` / `supplierIdOverride`, each resolving to the parent product's value at read time (`resolveVariantEconomics`). Nothing is copied onto a variant at creation. Historical CaseOrder / PO / receipt snapshots are authoritative and never re-derive. (`taxableOverride` mirrors the retained-but-dormant Phase-35 `MerchandiseProduct.taxable` catalog attribute; it drives no tax calculation.)

### 4. Organization-scoped cross-collection SKU uniqueness
A SKU is unique per organization across **both** `merchandiseProducts` and `merchandiseProductVariants`, enforced in `merchandiseVariantService` (trim-canonicalized, matching the Phase 35 convention). Wix's single-field unique index cannot span two collections, so a residual check-then-insert **TOCTOU race** remains — disclosed, same class as the Phase 35 product-SKU check.

### 5. Variant procurement, orders, reporting, UI, family-safe presentation
PO lines carry an optional `variantId`; receiving increments only that variant; Phase 36 AP three-way matching identifies the exact variant. CaseOrder merchandise selection carries `variantId`; the line snapshots the variant name/sku/price. Variant analytics reuse existing per-product metrics (a variant is a product). Staff UI: a variant editor embedded in the merchandise catalog. Family-facing DTOs expose the variant name via the line description only — never cost, supplier, or margin (structural-test enforced).

## Concurrency & limitations

Wix has no OCC/CAS; per-stock-line (now variant-aware) leases + write-claims + the append-only movement ledger + reconcile reduce practical race exposure but are not perfect serializability — retained and disclosed. The cross-collection SKU TOCTOU race (decision 4) is likewise disclosed. Variant-composed ids (lock key, balance id, reservation id) are hashed to a fixed 44-char id to stay under Wix's hard 128-char `_id` cap; the null-variant case stays byte-identical to Phase 35 (same pattern as the Phase 36 receiving-movement id).

## Migration

All schema changes are **additive and backward-compatible** — no data rewrite. `variantId` defaults null and `hasVariants` defaults false on every pre-Phase-37 row. **No synthetic "Default" variants** are created for existing products.

## RBAC

**No new permission keys.** Variants reuse `merchandise.read`/`merchandise.manage`; variant inventory reuses `inventory.*`. (A **pre-existing** grant-hygiene defect — legacy `rolePermissions` rows missing `createdAt`, and un-seeded `accounting.*` grants — affects live authorization of merchandise/accounting features on the `managed-cremations` org; it predates Phase 37 and is tracked as the separate **RBAC Grant Hygiene Remediation** follow-up in ROADMAP.md. Phase 37 added no new RBAC and its policy wiring is correct.)

## Live verification

The variant model was verified live through the real service layer (per-variant stock isolation, hasVariants flip, cross-collection SKU uniqueness, price/cost/supplier inheritance/override, reserve/fulfill/return, receiving idempotency, PO+receive+AP by variant, family-safe presentation, tenant isolation), with accounting-safe net-zero cleanup of the disposable exercise. The **`merchandiseProductVariants` collection (80) + additive `variantId`/`hasVariants` fields are permanent and live.**

**Sales-tax live artifacts — cleaned up (complete).** The removed sales-tax draft had created some live schema/accounting artifacts; they were cleaned up on the `managed-cremations` site under an explicit checkpoint:
- The `salesTaxConfigurations` collection (held zero rows) was **deleted cleanly** — collection + its two indexes gone (getCollection → 404); no immutable history depended on it.
- Account **`2200 Sales Tax Payable` was deactivated** (`isActive:false`, renamed "(deprecated — unused)"), **never deleted** — it is referenced by 6 immutable posted disposable-verification journal lines (`revenue_recognition` deltas + `reversal` entries) whose net effect on the account is **$0** (debit 31,500 / credit 31,500). No journal entry was deleted or rewritten; every account reference (by id) stays intact; no code path can post to it.
- The `caseOrders.taxLocationId`/`taxJurisdictionName`/`taxRateMicros` columns were **retained dormant** (Reserved / inactive — sales tax not implemented), by decision, to avoid field-removal risk on a live append-only versioned collection.

## Structural invariants (test-enforced)

`merchandiseProductVariants` written only by `merchandiseVariantService`; `hasVariants` flipped only via that service; no `/api/family/*` or portal DTO exposes cost/supplier on a variant surface.
