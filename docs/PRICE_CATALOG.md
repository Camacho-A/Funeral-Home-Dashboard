# SOLIS price catalog — design and Wix schema proposal (2026-11)

Status: **implemented on fictional data only** (branch `feat/price-catalog`).
**Nothing in Production Wix has been created or changed.** This document is
the exact proposal awaiting approval.

## 1. Architecture

One catalog engine for every organization. Each funeral home's catalog is its
own rows, filtered by `organizationId` on every read and conditioned on it on
every write; no price is shared or copied between organizations.

| What | Where it lives | New? |
|---|---|---|
| Funeral service packages, additional services, optional fees, organization-defined items | `serviceCatalog` (existing collection) — one row per item, `category` says how it prices (`base`, `service_type`, `addon`, `weight_surcharge`, `catalog_item`) | existing; 4 optional fields added |
| Merchandise and its variants | `merchandiseProducts`, `merchandiseProductVariants` (existing) — `retailPrice` / `retailPriceOverride` | no change |
| Display categories (how a catalog is organized on screen) | `serviceCatalogCategories` | **new** |
| Price history (every previous price, who, when, why) | `catalogPriceChanges` | **new** |
| Custom (one-off, staff-priced) order lines | `caseOrderLineItems` with `lineKind: 'custom'` (existing) | no change |
| Agreed prices on an order | `caseOrderLineItems.unitPrice` (existing, write-once) | no change |
| Repricing record | new `caseOrders` version + `caseOrderAuditEntries` rows with `action: 'line_repriced'` (existing collections; `action` is open text) | no change |

"Price not set" is `defaultPrice: null` — never $0. The pricing engine reports
such an item as unpriced and every order write that includes it is refused
(HTTP 422); screens label it "Price not set".

FTC classification is the existing optional `serviceCatalog.ftcClass` (Basic
services fee / Goods and services / Cash advance, or null = pending review),
snapshotted into each order line's `metadata` so a later reclassification
never restates a saved line or document.

### Per-organization settings (code, `domain/organization/organizationProfiles.ts`)

| Setting | Platform default (new funeral homes, Gus) | Manors |
|---|---|---|
| `priceCatalogManagement` — Settings › Price Catalog and its write routes | on | **off** (routes 404, area hidden) |
| `pricingPermissionModel` | `granular` | **`legacy`** |
| `orderLinePriceLock` — edits keep agreed line prices | on | **off** (pending your decision, §8) |

## 2. Pricing and order-integrity safeguards

| Requirement | How |
|---|---|
| A catalog price change never reprices an existing order | Existing order lines are write-once; a price change only writes the catalog row and its history row. |
| Existing lines keep their agreed price through edits | With `orderLinePriceLock`, an edit prices every line already on the order (services, catalog items, merchandise) at the unit price it was saved with; only lines added in that edit take today's price. |
| New orders use the current price | Order creation always reads the current catalog. |
| Repricing only by explicit, authorized action | `POST /api/cases/[caseId]/order/reprice`: preview (`confirm: false`, writes nothing), then confirm. Takes `caseOrder.update` **and** `caseOrder.reprice`. Pinned to the version shown (stale → 409). Writes one new order version through the journaled compare-and-swap path, with one `line_repriced` audit entry per moved line. Refused if any item is now unpriced. Custom items keep their own amounts. |
| Who changed a price and when; prior values kept | Append-only `catalogPriceChanges` row written **before** the price changes (if it can't be written, the price doesn't change): previous price, new price, identity, timestamp, optional reason, correlation id. Plus the existing `serviceCatalog.price.updated` activity event. |
| Existing order versions and audit records preserved | Unchanged: superseding is a field-scoped conditional patch; versions and audit entries are never rewritten. |
| No silent overwrites | Catalog price write = one field-scoped patch conditioned on `{ organizationId, beaconServiceCatalogId, defaultPrice: <value read> }` → 409 if someone changed it. Item/category edits carry a `revision` (expectedRevision → 409). |
| Manors orders untouched | No migration, no backfill, no rewrite of any existing row. Manors keeps re-pricing on edit until §8 decision 3. |

## 3. Permission model

Server-enforced in one module (`services/pricingAuthorization.ts`); screens
mirror it.

| Action | `granular` | `legacy` (Manors — exactly today's checks) |
|---|---|---|
| View the catalog | `serviceCatalog.read` | `serviceCatalog.read` |
| Create / edit catalog items and categories | `serviceCatalog.edit` | `serviceCatalog.edit` |
| Change a price (catalog or merchandise) | **`serviceCatalog.price`** | `serviceCatalog.edit` (merchandise: `merchandise.manage`) |
| Deactivate / reactivate an item | **`serviceCatalog.deactivate`** | `serviceCatalog.edit` (merchandise: `merchandise.manage`) |
| Add / change / remove custom order items | **`caseOrder.customItems`** | `caseOrder.update` |
| Reprice an existing order | **`caseOrder.reprice`** | not offered |

Proposed default grants for the four new keys: Administrator — all four;
Manager — `caseOrder.customItems`. Each organization can change them with its
existing role overrides. (Gus's earlier "catalog changes are Administrator
only" decision maps to revoking `serviceCatalog.edit` from Gus's Manager via
an organization override — see §8 decision 5.)

## 4. Exact proposed Wix schema

All collections: backend / API-key access only (no Member or Visitor access),
`beacon<Thing>Id` domain id, tenant isolation enforced in server code
(`organizationId` filter on every read, condition on every write, mapped row
re-checked). Respects the 3-regular + 1-unique index cap.

### 4.1 `serviceCatalog` — existing collection, additive optional fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `description` | Text | Optional | Internal description; never on an order line. |
| `categoryId` | Text | Optional | → `serviceCatalogCategories.beaconServiceCatalogCategoryId`. Display only; never affects pricing. |
| `merchandiseProductId` | Text | Optional | → `merchandiseProducts.beaconMerchandiseProductId`; a linked item takes price and stock from the product. |
| `revision` | Number | Optional | Optimistic-concurrency counter; absent = 0. |
| `defaultPrice` | Number | **change: must accept null** | Today documented as required. Verify the live field has no "required" validation; null = "price not set". |
| `ftcClass` | Text | Optional | Already proposed in Phase 39; **verify whether it exists live** — create only if absent. |

- Indexes: keep `organizationId`. Add regular `(organizationId, isActive)` — the active-catalog read. Item-code uniqueness per organization stays application-enforced.
- Compatibility: every existing row stays valid (all new fields optional; absent = today's meaning). **Affects Manors' collection** (shared), but no Manors row changes and Manors code ignores the fields.

### 4.2 `serviceCatalogCategories` — new

| Field | Type | Required | Notes |
|---|---|---|---|
| `beaconServiceCatalogCategoryId` | Text | Required, immutable | `_id` = this id. |
| `organizationId` | Text | Required, immutable | |
| `name` | Text | Required | Unique per organization (case-insensitive), ≤ 60 chars. |
| `nameKey` | Text | Required | `{organizationId}:{lowercased name}` — backs the unique index. |
| `sortOrder` | Number | Required | |
| `isActive` | Boolean | Required | Deactivate, never delete. |
| `revision` | Number | Required | Optimistic concurrency. |
| `createdAt`, `updatedAt` | Date | Required | |

- Indexes: regular `(organizationId, isActive)`; **unique** `nameKey`.
- Relationships: referenced by `serviceCatalog.categoryId`.
- Gus-only in practice (Manors has no categories); no migration.

### 4.3 `catalogPriceChanges` — new, insert-only

| Field | Type | Required | Notes |
|---|---|---|---|
| `beaconCatalogPriceChangeId` | Text | Required | `_id` = this id. |
| `organizationId` | Text | Required | |
| `itemType` | Text | Required | `service` / `merchandise_product` / `merchandise_variant`. |
| `itemId` | Text | Required | → `serviceCatalog` / `merchandiseProducts` / `merchandiseProductVariants` beacon id. |
| `itemCode` | Text | Required | serviceCode or SKU at the time. |
| `itemName` | Text | Required | Name at the time. |
| `previousPrice` | Number | Optional (null) | Integer cents; null = not set / inherits. |
| `newPrice` | Number | Optional (null) | Integer cents. |
| `changedBy` | Text | Optional (null) | Identity id; null = system (e.g. onboarding). |
| `changedAt` | Date | Required | |
| `reason` | Text | Optional | Free-text note. |
| `correlationId` | Text | Required | Ties to the request and its activity event. |

- Indexes: regular `(organizationId, itemType, itemId)` (one item's history); regular `(organizationId, changedAt)` (organization-wide price-change report).
- Never updated or deleted. No migration (history starts when enabled; earlier Manors price changes remain in `activityEvents`).
- Shared by all organizations; Manors rows would appear only if Manors' merchandise/catalog prices change after enablement.

### 4.4 RBAC data rows (not a schema change)

- `permissions`: 4 new rows — `serviceCatalog.price`, `serviceCatalog.deactivate`, `caseOrder.customItems`, `caseOrder.reprice`.
- `rolePermissions` (platform default roles, `organizationId: null`): Administrator × 4, Manager × 1 (`caseOrder.customItems`). Each grant row needs `createdAt`.
- **Affects Manors' role data** (default roles are shared). Manors' effective behaviour does not change — the `legacy` model never consults these keys — but the four keys will be visible in Manors' role/permission screens.

### 4.5 Unchanged (no schema change)

`caseOrders`, `caseOrderLineItems` (FTC class and catalog-item role go in the existing `metadata`), `caseOrderAuditEntries` (`line_repriced` is open text), `activityEvents` (new event types are open text), `merchandiseProducts`, `merchandiseProductVariants`.

### Are the new collections necessary?

- **Price history — yes.** `activityEvents` does record price changes, but it is a mixed audit stream with no `(organization, item)` index; reading one item's history means scanning the organization's whole activity log. A dedicated insert-only collection is cheap, indexed and keeps the history queryable forever.
- **Categories — recommended, not essential.** The alternative is a JSON list on the organization record (one row, no unique index, whole-list rewrites with a revision). It works for a handful of categories but loses per-row concurrency and uniqueness. If you prefer fewer collections, approve 4.1 + 4.3 now and defer categories (items then carry no category).

## 5. Manors compatibility impact

| Change | Manors effect |
|---|---|
| Code on this branch | None by design: Manors profile = catalog management off, `legacy` permissions, no line-price lock. Tested: Funeral Director still adds custom items; Manager still sets merchandise prices; edits still re-price; reprice not offered; catalog write routes 404. |
| `serviceCatalog` fields (4.1) | Shared collection gains optional columns; no row changes. |
| New collections (4.2, 4.3) | Manors never writes categories; price history rows only if enabled and Manors prices change. |
| RBAC rows (4.4) | Visible in role screens; no effective permission change. |
| Turning on `orderLinePriceLock` / `granular` for Manors | Would change Manors behaviour — only by your explicit decision (§8). |

## 6. Completed without Production schema changes

- Catalog engine, items, categories, FTC class, deactivation, inventory links, unpriced handling — fictional data (mock) only; live writes other than price-setting answer 501 until §4 is approved.
- Per-organization settings and permission model (all checks server-side).
- Order-line price lock and explicit reprice — work on live data for an organization that turns them on (no schema needed).
- Concurrency-safe live price write (conditional patch; no new field).
- Price history — mock storage; live storage switched off (`CATALOG_PRICE_HISTORY_LIVE`) until `catalogPriceChanges` exists.

## 7. After approval (rollout order)

1. Verify live `serviceCatalog` field rules (`defaultPrice` accepts null; whether `ftcClass` exists).
2. Create 4.1 fields, 4.3, then 4.2 (if approved) and their indexes on a disposable verification pass first.
3. Seed 4.4 rows.
4. Switch on `CATALOG_PRICE_HISTORY_LIVE` and the live catalog writes.
5. Gus onboarding: categories, its role overrides, prices when supplied (none invented).

## 8. Decisions requiring approval

1. **`serviceCatalog` additive fields (4.1)** — `description`, `categoryId`, `merchandiseProductId`, `revision`, the `(organizationId, isActive)` index, `defaultPrice` accepting null, and `ftcClass` if not already live.
2. **`catalogPriceChanges` collection (4.3)** — recommended.
3. **`serviceCatalogCategories` collection (4.2)** — approve, or defer and run without categories.
4. **RBAC rows (4.4)** — the four permission keys and default grants (Administrator: all four; Manager: `caseOrder.customItems`).
5. **Gus's role choices** — keep Gus's earlier decision that only Administrators change the catalog (organization override revoking `serviceCatalog.edit` from Gus's Manager), and that custom order items are Administrator + Manager.
6. **Manors stays as-is** — `legacy` permissions, no catalog management, edits keep re-pricing — or adopt the order-line price lock for Manors later. Adopting it changes what Manors staff see (an edit would no longer pick up a new price; they would use Reprice), so it would also need Manors' Reprice permission defined (proposal: `serviceCatalog.edit` on the legacy model, i.e. Administrators and Managers).
7. **Who may reprice by default** on the granular model — proposed Administrator only.
