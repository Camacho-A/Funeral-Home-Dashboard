import type { ServiceCatalogItem } from '../../types/serviceCatalog';
import type { ServiceSelections, WeightTier, MerchandiseSelection, CaseOrderLineKind } from '../../types/caseOrder';
import type { MerchandiseProduct } from '../../types/merchandiseProduct';
import { getMerchandiseCategoryDefinition } from '../merchandise/merchandiseCategoryRegistry';
import { SERVICE_CODES } from './serviceCodes';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine) — Beacon's
 * pricing engine. Pure, side-effect-free: no fetch, no I/O, no
 * organizationId. Both the browser (for the New Case/Edit Services "Live
 * Itemized Summary", instant, zero-latency) and the server
 * (services/pricingService.ts, authoritative) import this exact same
 * module — see docs/adr/ADR-023-case-order-pricing-engine.md's "client
 * preview vs. server authority" section for why that's safe: the SERVER
 * always re-fetches its own copy of the catalog and re-runs this same
 * function over the client's submitted *selections* (never a submitted
 * total/amount) before persisting anything, so a tampered browser total is
 * never trusted, even though the browser is allowed to compute and display
 * one for UX.
 *
 * Never imports anything from lib/wixDataApi.ts, services/*, or
 * hooks/*, and never will — that boundary is what keeps this shareable.
 */

export const MAX_EXTRA_DEATH_CERTIFICATE_QUANTITY = 20;

const WEIGHT_TIERS: WeightTier[] = ['under_200', '201_250', '251_300'];

export function isValidWeightTier(value: unknown): value is WeightTier {
  return typeof value === 'string' && (WEIGHT_TIERS as string[]).includes(value);
}

/**
 * "Under 200 lb" carries no surcharge line item at all — Manor's own price
 * list has no service code for it (+$0 means nothing to itemize), and no
 * organization's catalog is expected to ever define one either: a $0 line
 * item would only exist to explain why nothing is being charged, which
 * simply omitting the line already does. Returns null for `under_200`,
 * otherwise the serviceCode the catalog is expected to carry.
 */
export function weightTierServiceCode(tier: WeightTier): string | null {
  if (tier === '201_250') return SERVICE_CODES.WEIGHT_SURCHARGE_201_250;
  if (tier === '251_300') return SERVICE_CODES.WEIGHT_SURCHARGE_251_300;
  return null;
}

/**
 * Clamps/normalizes raw (possibly attacker-controlled) selection input into
 * a safe shape — called server-side before calculateOrderTotals ever sees
 * it. An invalid weightTier falls back to 'under_200' (the zero-cost
 * option) rather than throwing, since a malformed/missing selection should
 * never silently charge more than the family actually chose.
 */
export function normalizeSelections(raw: {
  weightTier?: unknown;
  extraDeathCertificateQuantity?: unknown;
  mailCremated?: unknown;
}): ServiceSelections {
  const weightTier = isValidWeightTier(raw.weightTier) ? raw.weightTier : 'under_200';
  const rawQty = typeof raw.extraDeathCertificateQuantity === 'number' ? raw.extraDeathCertificateQuantity : 0;
  const extraDeathCertificateQuantity = Math.min(
    Math.max(Math.trunc(rawQty), 0),
    MAX_EXTRA_DEATH_CERTIFICATE_QUANTITY,
  );
  const mailCremated = raw.mailCremated === true;
  return { weightTier, extraDeathCertificateQuantity, mailCremated };
}

export type CalculatedLineItem = {
  /** Phase 35: the commercial kind. Service lines are `'service'`;
      merchandise lines are `'merchandise'`. */
  lineKind: CaseOrderLineKind;
  /** ServiceCatalogItem.serviceCode for a service line; MerchandiseProduct.sku
      for a merchandise line. */
  serviceCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
  /** Phase 35: null for a service line; `{ productId, sku, locationId }` for
      a merchandise line (the product-identity snapshot carried onto the
      persisted CaseOrderLineItem.metadata). */
  metadata: Record<string, string> | null;
};

export type CalculatedOrderTotals = {
  lineItems: CalculatedLineItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
};

/**
 * The pricing engine's core calculation: catalog + selections -> itemized
 * line items + totals, in integer cents throughout. Silently omits a line
 * item whenever the catalog has no active row for the relevant
 * serviceCode — never throws for a missing/inactive catalog entry, since
 * that's simply "this organization doesn't sell that" rather than an
 * error condition. discountTotal/taxTotal are always 0 today (see
 * types/caseOrder.ts's own comment) — present in the return shape so a
 * future discount/tax feature is additive, not a signature change.
 */
export function calculateOrderTotals(
  catalog: ServiceCatalogItem[],
  selections: ServiceSelections,
): CalculatedOrderTotals {
  const catalogByCode = new Map(catalog.filter((item) => item.isActive).map((item) => [item.serviceCode, item]));
  const lineItems: CalculatedLineItem[] = [];

  function addFlatLine(serviceCode: string, quantity: number) {
    const item = catalogByCode.get(serviceCode);
    if (!item) return;
    lineItems.push({
      lineKind: 'service',
      serviceCode: item.serviceCode,
      description: item.displayName,
      quantity,
      unitPrice: item.defaultPrice,
      lineTotal: item.defaultPrice * quantity,
      sortOrder: item.sortOrder,
      metadata: null,
    });
  }

  addFlatLine(SERVICE_CODES.DIRECT_CREMATION, 1);

  const weightCode = weightTierServiceCode(selections.weightTier);
  if (weightCode) addFlatLine(weightCode, 1);

  if (selections.extraDeathCertificateQuantity > 0) {
    addFlatLine(SERVICE_CODES.EXTRA_DEATH_CERTIFICATE, selections.extraDeathCertificateQuantity);
  }

  if (selections.mailCremated) {
    addFlatLine(SERVICE_CODES.MAIL_CREMATED_REMAINS, 1);
  }

  lineItems.sort((a, b) => a.sortOrder - b.sortOrder);

  const subtotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const discountTotal = 0;
  const taxTotal = 0;
  const total = subtotal - discountTotal + taxTotal;

  return { lineItems, subtotal, discountTotal, taxTotal, total };
}

/**
 * total minus everything actually paid — never negative. `paidAmountCents`
 * is the sum of every 'succeeded' PaymentRecord for the *case* (see
 * services/pricingService.ts), independent of which CaseOrder version each
 * payment referenced.
 */
export function calculateBalance(total: number, paidAmountCents: number): number {
  return Math.max(total - paidAmountCents, 0);
}

export type AdjustmentType = 'discount' | 'surcharge';

/**
 * Reserved for a future manual adjustment feature (no UI in this phase
 * produces one — see types/caseOrder.ts's discountTotal comment). Returns
 * a signed cents delta: negative for a discount, positive for a surcharge.
 * `amountCents` itself is always a non-negative magnitude — the sign is
 * determined by `type`, never by the caller passing a negative number,
 * so a future caller can't accidentally flip a "discount" into a charge
 * by passing the wrong sign.
 */
export function calculateAdjustment(type: AdjustmentType, amountCents: number): number {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('Adjustment amount must be a non-negative integer number of cents.');
  }
  return type === 'discount' ? -amountCents : amountCents;
}

const WEIGHT_TIER_LABEL: Record<WeightTier, string> = {
  under_200: 'Under 200 lb',
  '201_250': '201–250 lb',
  '251_300': '251–300 lb',
};

export function weightTierLabel(tier: WeightTier): string {
  return WEIGHT_TIER_LABEL[tier];
}

/**
 * Reconstructs the ServiceSelections a previously-persisted CaseOrder's
 * line items represent — used by recalculateOrder to diff "what the order
 * used to be" against the staff member's new selections. Reverse of
 * calculateOrderTotals: looks for each known serviceCode's presence/
 * quantity rather than storing a parallel selections blob on CaseOrder
 * itself (which isn't part of this phase's own caseOrders field list).
 */
export function selectionsFromLineItems(lineItems: CalculatedLineItem[]): ServiceSelections {
  // Merchandise lines carry a product SKU as their serviceCode and never
  // collide with a known service code, so the lookups below simply ignore
  // them — but filter explicitly for clarity and future-proofing.
  const serviceLines = lineItems.filter((item) => item.lineKind === 'service');
  const byCode = new Map(serviceLines.map((item) => [item.serviceCode, item]));
  const weightTier: WeightTier = byCode.has(SERVICE_CODES.WEIGHT_SURCHARGE_251_300)
    ? '251_300'
    : byCode.has(SERVICE_CODES.WEIGHT_SURCHARGE_201_250)
      ? '201_250'
      : 'under_200';
  return {
    weightTier,
    extraDeathCertificateQuantity: byCode.get(SERVICE_CODES.EXTRA_DEATH_CERTIFICATE)?.quantity ?? 0,
    mailCremated: byCode.has(SERVICE_CODES.MAIL_CREMATED_REMAINS),
  };
}

// ---------------------------------------------------------------------------
// Phase 35 (Merchandise, Inventory & Commerce). Merchandise pricing — the
// second line-item kind that flows into the one authoritative CaseOrder. Pure
// and shareable exactly like the service path above: the server always
// re-fetches its own product catalog and re-runs these functions over the
// staff's submitted selections (never a submitted price/total).
// ---------------------------------------------------------------------------

/** Merchandise lines sort AFTER every service line (service sortOrders are
    small, catalog-driven). Grouped by category, then name, for a stable,
    legible order that never changes under repricing. */
export const MERCHANDISE_SORT_BASE = 100000;

const MAX_MERCHANDISE_LINE_QUANTITY = 1000;

/**
 * Clamps/normalizes raw (possibly attacker-controlled) merchandise selection
 * input — called server-side before pricing. Aggregates duplicate
 * (productId, locationId) rows by summing quantity, drops any row with a
 * non-positive quantity or a missing id, so one product at one location is
 * always exactly one line and one reservation.
 */
export function normalizeMerchandiseSelections(raw: unknown): MerchandiseSelection[] {
  if (!Array.isArray(raw)) return [];
  const aggregated = new Map<string, MerchandiseSelection>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.productId !== 'string' || row.productId.length === 0) continue;
    if (typeof row.locationId !== 'string' || row.locationId.length === 0) continue;
    const rawQty = typeof row.quantity === 'number' ? row.quantity : 0;
    const quantity = Math.min(Math.max(Math.trunc(rawQty), 0), MAX_MERCHANDISE_LINE_QUANTITY);
    if (quantity <= 0) continue;
    const key = `${row.productId}::${row.locationId}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + quantity, MAX_MERCHANDISE_LINE_QUANTITY);
    } else {
      aggregated.set(key, { productId: row.productId, locationId: row.locationId, quantity });
    }
  }
  return Array.from(aggregated.values());
}

/**
 * Builds merchandise line items from the org's product catalog + selections.
 * Snapshots the current `retailPrice` and `name` onto each line (historical
 * stability, same reasoning as a service line's copied `description`). Silently
 * omits a selection whose product is missing/inactive in the catalog — "this
 * org doesn't currently sell that" — never throws. Each line carries
 * `{ productId, sku, locationId }` in `metadata` so the persisted line stays
 * attributable after any later catalog change.
 */
export function calculateMerchandiseLineItems(
  products: MerchandiseProduct[],
  selections: MerchandiseSelection[],
): CalculatedLineItem[] {
  const productsById = new Map(products.filter((p) => p.isActive).map((p) => [p.id, p]));
  const lines: CalculatedLineItem[] = [];
  for (const selection of selections) {
    const product = productsById.get(selection.productId);
    if (!product) continue;
    lines.push({
      lineKind: 'merchandise',
      serviceCode: product.sku,
      description: product.name,
      quantity: selection.quantity,
      unitPrice: product.retailPrice,
      lineTotal: product.retailPrice * selection.quantity,
      sortOrder: 0, // assigned below after the stable sort
      metadata: { productId: product.id, sku: product.sku, locationId: selection.locationId },
    });
  }
  // Stable ordering: category sortOrder, then name, then sku.
  lines.sort((a, b) => {
    const catA = getMerchandiseCategoryDefinition(productsById.get(a.metadata!.productId)!.category)?.sortOrder ?? 999;
    const catB = getMerchandiseCategoryDefinition(productsById.get(b.metadata!.productId)!.category)?.sortOrder ?? 999;
    if (catA !== catB) return catA - catB;
    if (a.description !== b.description) return a.description < b.description ? -1 : 1;
    return a.serviceCode < b.serviceCode ? -1 : a.serviceCode > b.serviceCode ? 1 : 0;
  });
  lines.forEach((line, index) => {
    line.sortOrder = MERCHANDISE_SORT_BASE + index * 10;
  });
  return lines;
}

/**
 * The generalized full-order calculation: service lines (unchanged) plus
 * merchandise lines, into one itemized set of totals. `calculateOrderTotals`
 * above stays the service-only entry point (still used by the browser's live
 * preview and every pre-Phase-35 caller); this is what
 * services/pricingService.ts uses once merchandise exists.
 */
export function calculateOrderTotalsWithMerchandise(
  catalog: ServiceCatalogItem[],
  products: MerchandiseProduct[],
  orderSelections: OrderSelectionsInput,
): CalculatedOrderTotals {
  const serviceTotals = calculateOrderTotals(catalog, orderSelections.services);
  const merchandiseLines = calculateMerchandiseLineItems(products, orderSelections.merchandise);
  const lineItems = [...serviceTotals.lineItems, ...merchandiseLines];
  const subtotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const discountTotal = 0;
  const taxTotal = 0;
  const total = subtotal - discountTotal + taxTotal;
  return { lineItems, subtotal, discountTotal, taxTotal, total };
}

/** The structured full-order calculation input — mirrors types/caseOrder.ts's
    OrderSelections, redeclared as a minimal shape here to keep this pure
    module free of any dependency it doesn't strictly need. */
type OrderSelectionsInput = { services: ServiceSelections; merchandise: MerchandiseSelection[] };

/**
 * Reconstructs the merchandise selections a persisted CaseOrder's line items
 * represent — the merchandise counterpart to `selectionsFromLineItems`, so a
 * service-only edit carries existing merchandise forward unchanged (and vice
 * versa). Reads `{ productId, locationId }` from each merchandise line's
 * `metadata`.
 */
export function merchandiseSelectionsFromLineItems(lineItems: CalculatedLineItem[]): MerchandiseSelection[] {
  const selections: MerchandiseSelection[] = [];
  for (const line of lineItems) {
    if (line.lineKind !== 'merchandise' || !line.metadata) continue;
    const productId = line.metadata.productId;
    const locationId = line.metadata.locationId;
    if (typeof productId !== 'string' || typeof locationId !== 'string') continue;
    selections.push({ productId, locationId, quantity: line.quantity });
  }
  return selections;
}

/**
 * The service vs merchandise split of a set of line items' totals — used by
 * revenue recognition to credit Service Revenue (4000) and Merchandise
 * Revenue (4100) separately (ADR-039 decision 2). Works over both freshly
 * `CalculatedLineItem[]` and persisted `CaseOrderLineItem[]` (both carry
 * `lineKind` + `lineTotal`).
 */
export function sumLineTotalsByKind(
  lineItems: ReadonlyArray<{ lineKind: CaseOrderLineKind; lineTotal: number }>,
): { service: number; merchandise: number } {
  let service = 0;
  let merchandise = 0;
  for (const item of lineItems) {
    if (item.lineKind === 'merchandise') merchandise += item.lineTotal;
    else service += item.lineTotal;
  }
  return { service, merchandise };
}
