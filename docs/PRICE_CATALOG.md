# SOLIS price catalog — design and Wix schema (2026-11)

Status: architecture **approved 2026-11-01**; implemented and tested on
fictional data only (branch `feat/price-catalog`). **Nothing in Production
Wix has been created or changed.** §4 is the exact, live-verified schema
change awaiting final authorization.

## 1. Architecture

One catalog engine for every organization. Each funeral home's catalog is its
own rows, filtered by `organizationId` on every read and conditioned on it on
every write; no price is shared or copied between organizations.

| What | Where it lives | Change |
|---|---|---|
| Funeral service packages, additional services, optional fees, organization-defined items | `serviceCatalog` (existing) — one row per item, `category` says how it prices (`base`, `service_type`, `addon`, `weight_surcharge`, `catalog_item`) | 5 optional fields declared |
| Merchandise and its variants | `merchandiseProducts`, `merchandiseProductVariants` (existing) — `retailPrice` / `retailPriceOverride` | 1 optional field each (`priceChangeId`) |
| Display categories | `serviceCatalogCategories` | **new** |
| Price history (every change: previous/new price, who, when, why, outcome) | `catalogPriceChanges` | **new** |
| Custom (one-off, staff-priced) order lines | `caseOrderLineItems` with `lineKind: 'custom'` | none |
| Agreed prices on an order | `caseOrderLineItems.unitPrice` (write-once) | none |
| Repricing record | new `caseOrders` version + `caseOrderAuditEntries` rows with `action: 'line_repriced'` (`action` is open text) | none |

"Price not set" is `defaultPrice: null` — never $0. The pricing engine reports
such an item as unpriced and every order write that includes it is refused
(HTTP 422); screens label it "Price not set".

FTC classification is `serviceCatalog.ftcClass` (already declared live;
Basic services fee / Goods and services / Cash advance, or null = pending
review), snapshotted into each order line's `metadata`.

### Per-organization settings (`domain/organization/organizationProfiles.ts`)

| Setting | Platform default (new funeral homes, Gus) | Manors |
|---|---|---|
| `priceCatalogManagement` — Settings › Price Catalog and its write routes | on | **off** (routes 404, area hidden) |
| `pricingPermissionModel` | `granular` | **`legacy`** |
| `orderLinePriceLock` — edits keep agreed line prices | on | **off** (this release) |
| `standingRoleOverrides` — overrides written at onboarding | none | none |
| Gus | `standingRoleOverrides`: Manager `serviceCatalog.edit` **revoked** | — |

## 2. Pricing and order-integrity safeguards

| Requirement | How |
|---|---|
| A catalog price change never reprices an existing order | Order lines are write-once; a price change writes only the item and its history. |
| Existing lines keep their agreed price through edits | With `orderLinePriceLock`, an edit prices every existing line at the unit price it was saved with; only lines added in that edit take today's price. |
| New orders use the current price | Order creation always reads the current catalog. |
| Repricing only by explicit, authorized action | `POST /api/cases/[caseId]/order/reprice`: preview (`confirm: false`, writes nothing), then confirm. Takes `caseOrder.update` **and** `caseOrder.reprice` (Administrator only by default). Pinned to the version shown (stale → 409). One new version through the journaled compare-and-swap path, one `line_repriced` audit entry per moved line. Refused if any item is now unpriced. |
| Who changed a price, when; prior values kept | `catalogPriceChanges` row per change — see §2.1. Plus the existing `serviceCatalog.price.updated` activity event. |
| Order versions and audit records preserved | Unchanged: versions and audit entries are never rewritten. |
| No silent overwrites | Every price write is one field-scoped conditional patch conditioned on `{organizationId, <id>, <price>: <value read>, priceChangeId: <marker read>}` → 409 `price_conflict` if anyone changed it. Merchandise price changes use the same conditional patch instead of the full-replace write. Item/category edits carry a `revision`. |
| Manors orders untouched | No migration, backfill or rewrite of any existing row. |

### 2.1 Price history failure handling (no false atomicity)

Wix Data has **no transaction across collections**, so a price and its history
row cannot be written atomically together. What Wix does guarantee
(live-verified 2026-10-16, docs/CASE_CONCURRENCY.md) is that **one conditional
patch of one item applies all its fields or none**. The journal
(`services/catalogPriceChangeJournal.ts`) is built on exactly that:

1. Insert the history row `status: 'pending'`. If this fails, nothing changes.
2. One single-item conditional patch writes the price **and**
   `priceChangeId = <row id>` on the item. The marker is exact evidence of which
   recorded change set the current price.
3. Settle the row once (conditioned on `pending`): `applied`, or `not_applied`
   with outcome `conflict` / `write_failed`.

| Failure | Result |
|---|---|
| History insert fails | Error; price untouched; no row. |
| Concurrent edit (price changed after it was read) | 409; nothing overwritten; row `not_applied`/`conflict`. |
| A change to the same item is still pending (< 2 min) | Second request refused 409 `price_change_in_progress`; nothing written. |
| Price write fails | Item read back: marker absent → row `not_applied`/`write_failed`, error returned. |
| Response lost after the write landed | Item read back: marker present → row `applied`, success returned. |
| Request dies between steps (or the read-back fails) | Row stays `pending`. The next change to that item, or administrator recovery, settles it from the marker after 2 minutes (`reconciled_applied` / `reconciled_not_applied`). |
| Duplicate request (same `requestKey` / `Idempotency-Key`) | Deterministic row id → recognised; price never changed twice; an applied duplicate answers 200 `duplicate: true`. A twin racing in loses the insert (409) and writes nothing. |
| Write landed after its request settled it `not_applied` | Recovery sees the marker and corrects the row to `applied`. |
| Price changed outside SOLIS (e.g. in the Wix dashboard) | Reported as `priceDrift`; never "fixed". |

Administrator recovery: `GET /api/service-catalog/price-history/reconcile`
(read-only report) and `POST` (settle). Admin-tier **and** the organization's
price permission; own organization only; changes history statuses only, never
a price.

Live history storage stays **off** (`isCatalogPriceHistoryLive()`) until
`catalogPriceChanges` exists; while off, every live price write behaves exactly
as before (activity event only, no marker, merchandise full-replace).

## 3. Permission model

Server-enforced in `services/pricingAuthorization.ts`; screens mirror it.

| Action | `granular` | `legacy` (Manors — exactly today's checks) |
|---|---|---|
| View the catalog | `serviceCatalog.read` | `serviceCatalog.read` |
| Create / edit catalog items and categories | `serviceCatalog.edit` | `serviceCatalog.edit` |
| Change a price (catalog or merchandise) | `serviceCatalog.price` | `serviceCatalog.edit` (merchandise: `merchandise.manage`) |
| Deactivate / reactivate | `serviceCatalog.deactivate` | `serviceCatalog.edit` (merchandise: `merchandise.manage`) |
| Custom order items | `caseOrder.customItems` | `caseOrder.update` |
| Reprice an existing order | `caseOrder.reprice` | not offered |

Code defaults (`domain/rbac/defaultRoles.ts`): Administrator all four new keys;
Manager `caseOrder.customItems`. Gus additionally revokes `serviceCatalog.edit`
from its Manager (standing override), so at Gus catalog editing, prices,
deactivation and repricing are Administrator-only; its Manager views the
catalog and adds custom items.

**How the keys reach live data — no shared RBAC row is written.** The live
shared default-role rows do not hold the four keys (read 2026-11-01) and are
left that way. As every new key since the 2026-10 safe-onboarding work, a new
organization receives code-defined grants the shared rows lack as overrides
scoped to it (`seedOrganizationScopedDefaultGrants`), and its standing
overrides are written first. Manors' role data is therefore untouched.

## 4. Exact Wix schema changes (verified against live, 2026-11-01)

Read-only inspection of the live collections (GET collection + indexes, row
shape counts; script outside the repo, no writes). Findings that shaped this:

- `serviceCatalog` (revision 2): 11 declared fields, **none marked required**;
  `ftcClass` (TEXT) **already exists**; `createdAt`/`updatedAt` are **TEXT**
  (ISO strings), not Date; `beaconServiceCatalogId` is used by every row and
  every query but is **not declared**. One user index (`organizationId`).
  Manors: 8 rows, all with numeric prices (0 null, 0 at $0), 0 with `ftcClass`.
- `merchandiseProducts`, `merchandiseProductVariants`: **0 rows** live.
- `catalogPriceChanges`, `serviceCatalogCategories`: do not exist (404); no
  name conflict among the 93 live collections.
- `permissions` holds 22 keys (a mirror nothing reads at runtime; 52 keys
  added since were never mirrored) — left alone.
- Wix stores and filters fields a collection does not declare (live-verified
  for `cases.revision`); declaring a field adds no validation and changes no
  existing row.

All new/declared fields are optional; no existing field is changed, retyped
or removed; no existing index is changed.

### 4.1 `serviceCatalog` — declare 5 optional fields, add 1 index

| Field | Type | Notes |
|---|---|---|
| `description` | TEXT | Internal description; never on an order line. |
| `categoryId` | TEXT | → `serviceCatalogCategories.beaconServiceCatalogCategoryId`; display only. |
| `merchandiseProductId` | TEXT | → `merchandiseProducts.beaconMerchandiseProductId`. |
| `revision` | NUMBER | Optimistic concurrency; absent = 0. |
| `priceChangeId` | TEXT | Price history marker (§2.1); absent on every existing row. |

- Index: add regular `organizationId_isActive` (`organizationId` ASC, `isActive` ASC) → 2 of 3 regular slots.
- `defaultPrice`: **no change** — not required live, so null ("price not set") is storable and distinct from 0. (A null write itself is confirmed on a disposable row in rollout step 1.)
- `ftcClass`: **no change** — already declared.
- Optional housekeeping: declare `beaconServiceCatalogId` (TEXT) — documents what every row already carries.

### 4.2 `merchandiseProducts`, `merchandiseProductVariants` — declare 1 optional field each

| Field | Type | Notes |
|---|---|---|
| `priceChangeId` | TEXT | Price history marker. Both collections are empty live. Declaring is optional (Wix stores it undeclared) but recommended. |

### 4.3 `catalogPriceChanges` — new

Permissions: insert/update/remove/read **ADMIN** (API key only), like the other collections.

| Field | Type | Required (app) | Notes |
|---|---|---|---|
| `beaconCatalogPriceChangeId` | TEXT | yes | `_id` = this id (`cpc-` + 40 hex/uuid, ≤ 128 chars). |
| `organizationId` | TEXT | yes | |
| `itemType` | TEXT | yes | `service` / `merchandise_product` / `merchandise_variant`. |
| `itemId` | TEXT | yes | Beacon id of the item. |
| `itemCode` | TEXT | yes | serviceCode or SKU at the time. |
| `itemName` | TEXT | yes | Name at the time. |
| `previousPrice` | NUMBER | null allowed | Integer cents; null = not set / inherits. |
| `newPrice` | NUMBER | null allowed | Integer cents. |
| `changedBy` | TEXT | null allowed | Identity id; null = system. |
| `changedAt` | TEXT | yes | ISO timestamp. |
| `reason` | TEXT | no | |
| `correlationId` | TEXT | yes | Ties to the request and its activity event. |
| `status` | TEXT | yes | `pending` / `applied` / `not_applied`. |
| `outcome` | TEXT | no | `applied` / `conflict` / `write_failed` / `reconciled_applied` / `reconciled_not_applied`. |
| `settledAt` | TEXT | no | ISO timestamp. |
| `requestKey` | TEXT | no | Client idempotency key. |

- Indexes (3 regular): `organizationId_itemType_itemId`; `organizationId_changedAt`; `organizationId_status`.
- Rows are never deleted; values never edited; only `status`/`outcome`/`settledAt` move once (plus the one marker-proven `not_applied → applied` correction).

### 4.4 `serviceCatalogCategories` — new

Permissions: ADMIN for all operations.

| Field | Type | Required (app) | Notes |
|---|---|---|---|
| `beaconServiceCatalogCategoryId` | TEXT | yes | `_id` = this id. |
| `organizationId` | TEXT | yes | |
| `name` | TEXT | yes | ≤ 60 chars. |
| `nameKey` | TEXT | yes | `{organizationId}:{lowercased name}`. |
| `sortOrder` | NUMBER | yes | |
| `isActive` | BOOLEAN | yes | Deactivate, never delete. |
| `revision` | NUMBER | yes | |
| `createdAt`, `updatedAt` | TEXT | yes | ISO timestamps (live convention). |

- Indexes: regular `organizationId_isActive`; **unique** `nameKey`.

### 4.5 RBAC — no schema change, no shared row change

No `permissions`, `roles` or `rolePermissions` row is written. Gus's grants and
its Manager override are ordinary `organizationRolePermissionOverrides` rows
written by its onboarding (Gus-scoped).

### 4.6 Unchanged

`caseOrders`, `caseOrderLineItems` (`metadata` is OBJECT), `caseOrderAuditEntries`
(`action` TEXT), `activityEvents`, `organizationRolePermissionOverrides`, `roles`,
`rolePermissions`, `permissions`.

## 5. Manors

### 5.1 What happens today when Manors edits an order (master 1753668)

- Only an actual change creates a new version: unchanged selections write
  nothing, and a catalog price change alone never touches an order.
- Every change (Edit Services, add/remove/return merchandise, weight,
  certificates) recomputes **every** line at today's catalog / retail price;
  only custom items keep their amounts. So adding one urn to a January order
  moves its agreed service prices to March's — with no itemized audit line for
  the untouched lines (the total and revenue delta show it).
- Case field edits, payments, refunds, write-offs, checklist and crematory
  send never create a version.
- Superseded versions are never rewritten (only `status`, `balanceDue`).
- `balanceDue = max(total − succeeded payments, 0)` across all versions;
  refunds drop out (status `refunded`); no payment or refund record is ever
  modified by a recalculation.

### 5.2 Financial-integrity risks in today's Manors behaviour (reported, not changed)

| Risk | Severity | Status |
|---|---|---|
| Two simultaneous edits → two active versions, revenue posted twice | High | Fixed on this branch line by order versioning (compare-and-swap) — already part of `feat/gus-parity-port`. |
| Crash between supersede and insert → no active order | High | Fixed on this branch line (journaled operations + administrator repair). |
| Any edit silently reprices untouched lines at current prices | Medium | **Not changed** for Manors (line-price lock off by decision). |
| Deactivating a service drops it from the next edit, lowering the total | Medium | Not changed for Manors. |
| A total reduced below the amount paid shows $0 with no credit/refund prompt; a raised total doesn't revert "paid in full" | Medium | Not changed. |
| Completed cases' orders stay editable; merchandise and return routes skip the archive check | Low–medium | Not changed. |
| Recalculation ignores write-offs in `balanceDue` until the next payment refresh | Low | Not changed. |

### 5.3 This release's effect on Manors

| Change | Effect |
|---|---|
| Code (catalog, permissions, lock, reprice) | None: catalog management off, `legacy` permissions, no line lock, no reprice. Tested. |
| Price history journal | Off until enabled. Once on: Manors price changes (it has no in-app catalog price editing; merchandise is empty) gain history rows, and a merchandise price edit becomes a conditional patch (409 on a simultaneous change instead of last-write-wins). |
| `serviceCatalog` declarations + index | Shared collection; no row changes; Manors code ignores the fields. |
| RBAC | **None** — no shared row and no Manors row written. |

## 6. Completed without Production schema changes

- Catalog engine, categories, FTC class, deactivation, inventory links, unpriced handling — fictional data; live catalog writes other than price answer 501.
- Permission model, standing overrides, Gus onboarding grants — server-side; tested.
- Order-line price lock and explicit reprice.
- Concurrency-safe price writes (service and merchandise).
- Price history journal, idempotency and administrator recovery — tested on the in-memory Wix stand-in; live storage off.

## 7. Rollout (after authorization)

1. Disposable verification pass on a `verification-sandbox` organization row: null `defaultPrice` write/read; conditional patch with `priceChangeId: {$eq: null}` on `serviceCatalog`; insert-conflict on `catalogPriceChanges`. Delete the rows afterwards.
2. Declare the §4.1/§4.2 fields; add the `serviceCatalog` index.
3. Create `catalogPriceChanges` (+3 indexes) and `serviceCatalogCategories` (+2 indexes).
4. Switch on live history storage (code release).
5. Gus onboarding (separate approval): its role overrides, categories, prices when supplied — none invented.
