import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import type { ServiceCatalogCategory, ServiceCatalogItem } from '../types/serviceCatalog';
import { ACTIVITY_EVENT_TYPES } from '../types/activityEvent';
import { CATALOG_ITEM_CATEGORY, SERVICE_CODES, SERVICE_TYPE_CATEGORY } from '../domain/pricing/serviceCodes';
import { formatCentsAsCurrency } from '../utils/format';
import { isValidServiceCatalogPrice } from './pricingService';
import { recordServiceCatalogChange, recordServiceCatalogPriceUpdated, type ActivityContext } from './activityService';
import { recordCatalogPriceChange } from './catalogPriceHistoryService';
import { getProductById } from './merchandiseService';
import { FTC_CLASS, isFtcClass, type FtcClass } from '../domain/billing/ftcComplianceRegistry';
import { serviceCatalogCategoryFixtures, serviceCatalogFixtures } from './__mocks__/pricingFixtures';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). Settings › Price
 * Catalog's writes: creating and editing catalog items (code, name,
 * description, category, price, active flag) and the organization's own
 * display categories.
 *
 * Rules every write follows:
 * - strictly organization-scoped — another organization's id is "not found";
 * - optimistic concurrency — each row carries a `revision`; an edit names
 *   the revision it was made against and is refused (nothing written) when
 *   the row has changed since;
 * - audited in the same request — the activity event is recorded BEFORE the
 *   row changes, so a change whose audit can't be written is never made;
 * - an existing case order is never touched — its lines keep the price and
 *   description they were saved with (see catalogWithOrderSnapshots in
 *   domain/pricing/calculateOrder.ts).
 *
 * Demo data (mock adapter) only for now: the live (Wix) catalog has no
 * category collection or item-editing schema yet, so every call there
 * refuses with PriceCatalogUnavailableError — setting a price on live data
 * still goes through pricingService.updateServiceCatalogItemPrice.
 * Authorization is the route's job (canConfigureServiceCatalog).
 */

export class PriceCatalogError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
    readonly reason: 'invalid' | 'not_found' | 'duplicate_code' | 'duplicate_name' | 'revision_conflict' | 'not_allowed' | 'confirmation_required',
  ) {
    super(message);
    this.name = 'PriceCatalogError';
  }
}

export class PriceCatalogUnavailableError extends Error {
  constructor() {
    super('Managing the price catalog is available on demo data only until the live catalog is set up.');
    this.name = 'PriceCatalogUnavailableError';
  }
}

export const PRICE_CATALOG_REVISION_CONFLICT_MESSAGE =
  'This catalog entry was changed by someone else since you opened it. Nothing was saved — reload and try again.';

export const MAX_CATALOG_ITEM_NAME_LENGTH = 120;
export const MAX_CATALOG_ITEM_DESCRIPTION_LENGTH = 500;
export const MAX_CATALOG_CATEGORY_NAME_LENGTH = 60;
export const MAX_CATALOG_CATEGORY_SORT_ORDER = 100_000;
/** Administrator-added items sort after the primary services. */
const FIRST_CATALOG_ITEM_SORT_ORDER = 1000;

/** An item code: what order lines, audit history and reports key off —
    letters, digits, `_` and `-`, starting with a letter or digit. Stored
    upper-case, so codes compare case-insensitively. */
const ITEM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;

/** Codes the pricing engine already gives a fixed role (Manor's Cremation's
    base service, weight tiers and add-ons). An administrator-added item may
    never take one, or a single code could be charged two ways. */
const RESERVED_ITEM_CODES = new Set<string>(Object.values(SERVICE_CODES));

export const CATALOG_PRICING_TYPES = ['flat', 'per_unit'] as const;
export type CatalogPricingType = (typeof CATALOG_PRICING_TYPES)[number];

export function normalizeItemCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return ITEM_CODE_PATTERN.test(code) ? code : null;
}

function normalizeName(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  return name.length > 0 && name.length <= maxLength ? name : null;
}

/** null/'' clears; otherwise trimmed text within the limit. Undefined is "invalid". */
function normalizeDescription(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  const text = raw.trim();
  if (text.length > MAX_CATALOG_ITEM_DESCRIPTION_LENGTH) return { ok: false };
  return { ok: true, value: text.length === 0 ? null : text };
}

const revisionOf = (row: { revision?: number }): number => row.revision ?? 0;

/** The FTC classifications an administrator can choose — exactly the
    existing registry's (domain/billing/ftcComplianceRegistry.ts). Pending
    review is stored as null: `unclassified` is accepted and normalized to it.
    Never derived from a name or category. */
export const CATALOG_FTC_CLASSES: readonly FtcClass[] = [FTC_CLASS.BASIC_SERVICES_FEE, FTC_CLASS.GOODS_AND_SERVICES, FTC_CLASS.CASH_ADVANCE];

function normalizeFtcClass(raw: unknown): { ok: true; value: FtcClass | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === '' || raw === FTC_CLASS.UNCLASSIFIED) return { ok: true, value: null };
  return isFtcClass(raw) ? { ok: true, value: raw } : { ok: false };
}

const INVALID_FTC_MESSAGE = `ftcClass must be one of ${CATALOG_FTC_CLASSES.join(', ')}, or null for "pending review".`;

function assertDemoData(dataAdapterMode: DataAdapterMode): void {
  if (dataAdapterMode !== 'mock') throw new PriceCatalogUnavailableError();
}

function assertRevision(row: { revision?: number }, expectedRevision: unknown): void {
  if (expectedRevision === undefined) return;
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision)) {
    throw new PriceCatalogError('expectedRevision must be a whole number.', 400, 'invalid');
  }
  if (revisionOf(row) !== expectedRevision) throw new PriceCatalogError(PRICE_CATALOG_REVISION_CONFLICT_MESSAGE, 409, 'revision_conflict');
}

const describePrice = (cents: number | null) => (cents === null ? 'not set' : formatCentsAsCurrency(cents, 'usd'));

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCatalogCategories(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  options: { includeInactive?: boolean } = {},
): Promise<ServiceCatalogCategory[]> {
  // The live catalog has no categories yet: an empty list, never an error,
  // so the catalog itself still loads.
  if (dataAdapterMode !== 'mock') return [];
  return serviceCatalogCategoryFixtures
    .filter((category) => category.organizationId === organizationId && (options.includeInactive || category.isActive))
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((category) => ({ ...category }));
}

function categoriesOf(organizationId: string): ServiceCatalogCategory[] {
  return serviceCatalogCategoryFixtures.filter((category) => category.organizationId === organizationId);
}

function assertCategoryNameFree(organizationId: string, name: string, exceptId: string | null): void {
  const taken = categoriesOf(organizationId).some((category) => category.id !== exceptId && category.name.toLowerCase() === name.toLowerCase());
  if (taken) throw new PriceCatalogError(`A category named "${name}" already exists.`, 409, 'duplicate_name');
}

export async function createCatalogCategory(
  params: { organizationId: string; name: unknown; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<ServiceCatalogCategory> {
  assertDemoData(dataAdapterMode);
  const name = normalizeName(params.name, MAX_CATALOG_CATEGORY_NAME_LENGTH);
  if (!name) throw new PriceCatalogError(`A category name is required (at most ${MAX_CATALOG_CATEGORY_NAME_LENGTH} characters).`, 400, 'invalid');
  assertCategoryNameFree(params.organizationId, name, null);
  const nowIso = params.now ?? new Date().toISOString();
  const sortOrder = categoriesOf(params.organizationId).reduce((max, category) => Math.max(max, category.sortOrder), 0) + 10;
  const category: ServiceCatalogCategory = {
    id: `catalog-category-${crypto.randomUUID()}`,
    organizationId: params.organizationId,
    name,
    sortOrder,
    isActive: true,
    revision: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await recordServiceCatalogChange(
    ctx,
    {
      eventType: ACTIVITY_EVENT_TYPES.SERVICE_CATALOG_CATEGORY_CREATED,
      resourceType: 'serviceCatalogCategory',
      resourceId: category.id,
      previous: null,
      next: { name },
      description: `Price catalog category "${name}" added`,
    },
    dataAdapterMode,
  );
  serviceCatalogCategoryFixtures.push(category);
  return { ...category };
}

export async function updateCatalogCategory(
  params: { organizationId: string; categoryId: string; changes: Record<string, unknown>; expectedRevision: unknown; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<ServiceCatalogCategory> {
  assertDemoData(dataAdapterMode);
  const index = serviceCatalogCategoryFixtures.findIndex((c) => c.id === params.categoryId && c.organizationId === params.organizationId);
  if (index === -1) throw new PriceCatalogError('Category not found for this organization.', 404, 'not_found');
  const current = serviceCatalogCategoryFixtures[index];
  if (params.expectedRevision === undefined) throw new PriceCatalogError('expectedRevision is required.', 400, 'invalid');
  assertRevision(current, params.expectedRevision);

  const next: ServiceCatalogCategory = { ...current };
  const { changes } = params;
  if ('name' in changes) {
    const name = normalizeName(changes.name, MAX_CATALOG_CATEGORY_NAME_LENGTH);
    if (!name) throw new PriceCatalogError(`A category name is required (at most ${MAX_CATALOG_CATEGORY_NAME_LENGTH} characters).`, 400, 'invalid');
    assertCategoryNameFree(params.organizationId, name, current.id);
    next.name = name;
  }
  if ('sortOrder' in changes) {
    const sortOrder = changes.sortOrder;
    if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > MAX_CATALOG_CATEGORY_SORT_ORDER) {
      throw new PriceCatalogError(`sortOrder must be a whole number from 0 to ${MAX_CATALOG_CATEGORY_SORT_ORDER}.`, 400, 'invalid');
    }
    next.sortOrder = sortOrder;
  }
  if ('isActive' in changes) {
    if (typeof changes.isActive !== 'boolean') throw new PriceCatalogError('isActive must be true or false.', 400, 'invalid');
    next.isActive = changes.isActive;
  }

  const changed = (['name', 'sortOrder', 'isActive'] as const).filter((field) => next[field] !== current[field]);
  if (changed.length === 0) return { ...current };
  next.revision = revisionOf(current) + 1;
  next.updatedAt = params.now ?? new Date().toISOString();

  await recordServiceCatalogChange(
    ctx,
    {
      eventType: ACTIVITY_EVENT_TYPES.SERVICE_CATALOG_CATEGORY_UPDATED,
      resourceType: 'serviceCatalogCategory',
      resourceId: current.id,
      previous: Object.fromEntries(changed.map((field) => [field, current[field]])),
      next: Object.fromEntries(changed.map((field) => [field, next[field]])),
      description: `Price catalog category "${current.name}" updated (${changed.join(', ')})`,
    },
    dataAdapterMode,
  );
  serviceCatalogCategoryFixtures[index] = next;
  return { ...next };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function resolveCategoryId(organizationId: string, raw: unknown, currentCategoryId: string | null): string | null {
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new PriceCatalogError('categoryId must be a category id or null.', 400, 'invalid');
  const category = categoriesOf(organizationId).find((c) => c.id === raw);
  if (!category) throw new PriceCatalogError('Category not found for this organization.', 400, 'invalid');
  // A deactivated category can be kept, never newly chosen.
  if (!category.isActive && raw !== currentCategoryId) throw new PriceCatalogError(`The category "${category.name}" is inactive.`, 400, 'invalid');
  return category.id;
}

function itemsOf(organizationId: string): ServiceCatalogItem[] {
  return serviceCatalogFixtures.filter((item) => item.organizationId === organizationId);
}

export async function createCatalogItem(
  params: {
    organizationId: string;
    input: { itemCode?: unknown; displayName?: unknown; description?: unknown; categoryId?: unknown; pricingType?: unknown; defaultPrice?: unknown; ftcClass?: unknown };
    now?: string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<ServiceCatalogItem> {
  assertDemoData(dataAdapterMode);
  const { input, organizationId } = params;
  const serviceCode = normalizeItemCode(input.itemCode);
  if (!serviceCode) {
    throw new PriceCatalogError('An item code is required: 2–40 letters, digits, "_" or "-", starting with a letter or digit.', 400, 'invalid');
  }
  if (itemsOf(organizationId).some((item) => item.serviceCode.toUpperCase() === serviceCode)) {
    throw new PriceCatalogError(`The item code ${serviceCode} is already used in this catalog.`, 409, 'duplicate_code');
  }
  if (RESERVED_ITEM_CODES.has(serviceCode)) throw new PriceCatalogError(`The item code ${serviceCode} is reserved. Choose another code.`, 400, 'invalid');
  const displayName = normalizeName(input.displayName, MAX_CATALOG_ITEM_NAME_LENGTH);
  if (!displayName) throw new PriceCatalogError(`A name is required (at most ${MAX_CATALOG_ITEM_NAME_LENGTH} characters).`, 400, 'invalid');
  const description = normalizeDescription(input.description ?? null);
  if (!description.ok) throw new PriceCatalogError(`The description must be text of at most ${MAX_CATALOG_ITEM_DESCRIPTION_LENGTH} characters.`, 400, 'invalid');
  if (typeof input.pricingType !== 'string' || !(CATALOG_PRICING_TYPES as readonly string[]).includes(input.pricingType)) {
    throw new PriceCatalogError('pricingType must be "flat" or "per_unit".', 400, 'invalid');
  }
  const defaultPrice = input.defaultPrice === undefined ? null : input.defaultPrice;
  if (!isValidServiceCatalogPrice(defaultPrice)) {
    throw new PriceCatalogError('The price must be a non-negative whole number of cents (at most $1,000,000.00), or empty for "price not set".', 400, 'invalid');
  }
  const categoryId = resolveCategoryId(organizationId, input.categoryId ?? null, null);
  const ftcClass = normalizeFtcClass(input.ftcClass);
  if (!ftcClass.ok) throw new PriceCatalogError(INVALID_FTC_MESSAGE, 400, 'invalid');

  const nowIso = params.now ?? new Date().toISOString();
  const sortOrder = Math.max(FIRST_CATALOG_ITEM_SORT_ORDER - 10, ...itemsOf(organizationId).map((item) => item.sortOrder)) + 10;
  const item: ServiceCatalogItem = {
    id: `catalog-item-${crypto.randomUUID()}`,
    organizationId,
    serviceCode,
    displayName,
    description: description.value,
    categoryId,
    ftcClass: ftcClass.value,
    merchandiseProductId: null,
    category: CATALOG_ITEM_CATEGORY,
    pricingType: input.pricingType,
    defaultPrice,
    isActive: true,
    sortOrder,
    revision: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await recordServiceCatalogChange(
    ctx,
    {
      eventType: ACTIVITY_EVENT_TYPES.SERVICE_CATALOG_ITEM_CREATED,
      resourceType: 'serviceCatalogItem',
      resourceId: item.id,
      previous: null,
      next: { serviceCode, displayName, description: description.value, categoryId, pricingType: item.pricingType, defaultPrice, ftcClass: ftcClass.value },
      description: `Catalog item "${displayName}" (${serviceCode}) added — price ${describePrice(defaultPrice)}${item.pricingType === 'per_unit' ? ' each' : ''}`,
    },
    dataAdapterMode,
  );
  // Price history (2026-11): an item created with a price starts its history.
  await recordCatalogPriceChange(
    ctx,
    { itemType: 'service', itemId: item.id, itemCode: serviceCode, itemName: displayName, previousPrice: null, newPrice: defaultPrice, now: nowIso },
    dataAdapterMode,
  );
  serviceCatalogFixtures.push(item);
  return { ...item };
}

const EDITABLE_ITEM_FIELDS = ['displayName', 'description', 'categoryId', 'defaultPrice', 'isActive', 'ftcClass', 'merchandiseProductId'] as const;
type EditableItemField = (typeof EDITABLE_ITEM_FIELDS)[number];

export const PRIMARY_SERVICE_DEACTIVATION_WARNING =
  'Deactivating a primary service removes it from the services staff can choose for NEW cases. Existing cases on it keep working — their orders, documents, payments and workflow are unchanged — and you can reactivate it at any time. Confirm to deactivate.';

/**
 * Validates linking a catalog item to an inventory-tracked merchandise
 * product (or `null` to unlink). Only an administrator-added item can be
 * linked; the product must be one of this organization's own active,
 * independently sellable products (not a variant parent), and a product
 * links to at most one catalog item. Never touches stock.
 */
async function resolveMerchandiseLink(
  organizationId: string,
  item: ServiceCatalogItem,
  raw: unknown,
  dataAdapterMode: DataAdapterMode,
): Promise<string | null> {
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new PriceCatalogError('merchandiseProductId must be a merchandise product id or null.', 400, 'invalid');
  if (item.category !== CATALOG_ITEM_CATEGORY) {
    throw new PriceCatalogError('Only an added catalog item can be linked to an inventory record — not a primary service.', 400, 'not_allowed');
  }
  if (raw === item.merchandiseProductId) return raw;
  const product = await getProductById(organizationId, raw, dataAdapterMode);
  if (!product || product.organizationId !== organizationId) throw new PriceCatalogError('Merchandise product not found for this organization.', 400, 'invalid');
  if (!product.isActive) throw new PriceCatalogError(`"${product.name}" is archived and can't be linked.`, 400, 'invalid');
  if (product.hasVariants) {
    throw new PriceCatalogError(`"${product.name}" is sold by variant; linking a variant product isn't supported yet.`, 400, 'not_allowed');
  }
  const holder = itemsOf(organizationId).find((other) => other.id !== item.id && other.merchandiseProductId === raw);
  if (holder) throw new PriceCatalogError(`"${product.name}" is already linked to the catalog item ${holder.serviceCode}.`, 409, 'duplicate_code');
  return raw;
}

/** True when `changes` only sets a price — the one edit the live (Wix)
    catalog supports today (pricingService.updateServiceCatalogItemPrice). */
export function isPriceOnlyChange(changes: Record<string, unknown>): boolean {
  const keys = Object.keys(changes);
  return keys.length === 1 && keys[0] === 'defaultPrice';
}

/**
 * Edits one item. The code and pricing type never change after creation —
 * order lines and their quantities key off them. A primary service
 * (`service_type`) can be renamed, described, filed and priced, but not
 * deactivated here: case workflows are assigned by service type.
 */
export async function updateCatalogItem(
  params: {
    organizationId: string;
    itemId: string;
    changes: Record<string, unknown>;
    expectedRevision: unknown;
    /** Optional note kept with a price change in the price history. */
    reason?: string;
    /** Required (true) to deactivate a primary service — see below. */
    confirmPrimaryServiceDeactivation?: unknown;
    now?: string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<{ item: ServiceCatalogItem; changed: EditableItemField[] }> {
  assertDemoData(dataAdapterMode);
  const index = serviceCatalogFixtures.findIndex((item) => item.id === params.itemId && item.organizationId === params.organizationId);
  if (index === -1) throw new PriceCatalogError('Catalog item not found for this organization.', 404, 'not_found');
  const current = serviceCatalogFixtures[index];
  assertRevision(current, params.expectedRevision);

  const { changes } = params;
  for (const key of Object.keys(changes)) {
    if (key === 'serviceCode' || key === 'itemCode' || key === 'pricingType' || key === 'category') {
      throw new PriceCatalogError("An item's code and pricing type can't be changed once it exists.", 400, 'not_allowed');
    }
    if (!(EDITABLE_ITEM_FIELDS as readonly string[]).includes(key)) throw new PriceCatalogError(`Unknown field: ${key}.`, 400, 'invalid');
  }

  const next: ServiceCatalogItem = { ...current };
  if ('displayName' in changes) {
    const displayName = normalizeName(changes.displayName, MAX_CATALOG_ITEM_NAME_LENGTH);
    if (!displayName) throw new PriceCatalogError(`A name is required (at most ${MAX_CATALOG_ITEM_NAME_LENGTH} characters).`, 400, 'invalid');
    next.displayName = displayName;
  }
  if ('description' in changes) {
    const description = normalizeDescription(changes.description);
    if (!description.ok) throw new PriceCatalogError(`The description must be text of at most ${MAX_CATALOG_ITEM_DESCRIPTION_LENGTH} characters.`, 400, 'invalid');
    next.description = description.value;
  }
  if ('categoryId' in changes) next.categoryId = resolveCategoryId(params.organizationId, changes.categoryId, current.categoryId ?? null);
  if ('defaultPrice' in changes) {
    if (!isValidServiceCatalogPrice(changes.defaultPrice)) {
      throw new PriceCatalogError('The price must be a non-negative whole number of cents (at most $1,000,000.00), or null for "price not set".', 400, 'invalid');
    }
    next.defaultPrice = changes.defaultPrice;
  }
  if ('isActive' in changes) {
    if (typeof changes.isActive !== 'boolean') throw new PriceCatalogError('isActive must be true or false.', 400, 'invalid');
    // Deactivating a primary service takes an explicit confirmation: it is
    // no longer offered for NEW cases. Existing cases, their orders,
    // documents, payments and workflow assignments are untouched, and
    // reactivating it restores it. Reactivation needs no confirmation.
    if (current.category === SERVICE_TYPE_CATEGORY && current.isActive && changes.isActive === false && params.confirmPrimaryServiceDeactivation !== true) {
      throw new PriceCatalogError(PRIMARY_SERVICE_DEACTIVATION_WARNING, 409, 'confirmation_required');
    }
    next.isActive = changes.isActive;
  }
  if ('ftcClass' in changes) {
    const ftcClass = normalizeFtcClass(changes.ftcClass);
    if (!ftcClass.ok) throw new PriceCatalogError(INVALID_FTC_MESSAGE, 400, 'invalid');
    next.ftcClass = ftcClass.value;
  }
  if ('merchandiseProductId' in changes) {
    next.merchandiseProductId = await resolveMerchandiseLink(params.organizationId, current, changes.merchandiseProductId, dataAdapterMode);
  }
  // A linked item's price is the inventory record's: it keeps no price of its own.
  if ((next.merchandiseProductId ?? null) !== null && next.defaultPrice !== null) {
    throw new PriceCatalogError(
      'An item linked to an inventory record takes its price from that record. Clear this item’s price (leave it “not set”) to link it.',
      400,
      'invalid',
    );
  }

  const same = (field: EditableItemField) => (current[field] ?? null) === (next[field] ?? null);
  const changed = EDITABLE_ITEM_FIELDS.filter((field) => !same(field));
  if (changed.length === 0) return { item: { ...current }, changed };
  next.revision = revisionOf(current) + 1;
  next.updatedAt = params.now ?? new Date().toISOString();

  // Audit first: if any record can't be written, nothing changes.
  if (changed.includes('defaultPrice')) {
    await recordServiceCatalogPriceUpdated(ctx, current.id, next.displayName, current.defaultPrice, next.defaultPrice, dataAdapterMode);
    // Price history (2026-11): the previous value is kept, append-only.
    await recordCatalogPriceChange(
      ctx,
      {
        itemType: 'service',
        itemId: current.id,
        itemCode: current.serviceCode,
        itemName: next.displayName,
        previousPrice: current.defaultPrice,
        newPrice: next.defaultPrice,
        reason: params.reason ?? null,
        now: next.updatedAt,
      },
      dataAdapterMode,
    );
  }
  if (changed.includes('isActive')) {
    await recordServiceCatalogChange(
      ctx,
      {
        eventType: next.isActive ? ACTIVITY_EVENT_TYPES.SERVICE_CATALOG_ITEM_REACTIVATED : ACTIVITY_EVENT_TYPES.SERVICE_CATALOG_ITEM_DEACTIVATED,
        resourceType: 'serviceCatalogItem',
        resourceId: current.id,
        previous: { isActive: current.isActive },
        next: { isActive: next.isActive },
        description: `Catalog item "${next.displayName}" (${current.serviceCode}) ${next.isActive ? 'reactivated' : 'deactivated'}`,
      },
      dataAdapterMode,
    );
  }
  const detailFields = changed.filter((field) => field !== 'defaultPrice' && field !== 'isActive');
  if (detailFields.length > 0) {
    await recordServiceCatalogChange(
      ctx,
      {
        eventType: ACTIVITY_EVENT_TYPES.SERVICE_CATALOG_ITEM_UPDATED,
        resourceType: 'serviceCatalogItem',
        resourceId: current.id,
        previous: Object.fromEntries(detailFields.map((field) => [field, current[field] ?? null])),
        next: Object.fromEntries(detailFields.map((field) => [field, next[field] ?? null])),
        description: `Catalog item "${current.displayName}" (${current.serviceCode}) updated (${detailFields.join(', ')})`,
      },
      dataAdapterMode,
    );
  }
  serviceCatalogFixtures[index] = next;
  return { item: { ...next }, changed };
}
