import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixServiceCatalogItem,
  type WixServiceCatalogItem,
} from '../lib/wixServiceCatalogMapper';
import {
  mapWixCaseOrderItem,
  buildWixCaseOrderData,
  applyCaseOrderUpdateToWixData,
  type WixCaseOrderItem,
} from '../lib/wixCaseOrderMapper';
import {
  mapWixCaseOrderLineItemItem,
  buildWixCaseOrderLineItemData,
  type WixCaseOrderLineItemItem,
} from '../lib/wixCaseOrderLineItemMapper';
import {
  mapWixCaseOrderAuditItem,
  buildWixCaseOrderAuditData,
  type WixCaseOrderAuditItem,
} from '../lib/wixCaseOrderAuditMapper';
import type { ServiceCatalogItem } from '../types/serviceCatalog';
import type { CaseOrder, CaseOrderLineItem, ServiceSelections, MerchandiseSelection } from '../types/caseOrder';
import type { CaseOrderAuditEntry } from '../types/caseOrderAudit';
import type { MerchandiseProduct } from '../types/merchandiseProduct';
import {
  calculateAdjustment,
  calculateBalance,
  calculateOrderTotals,
  calculateOrderTotalsWithMerchandise,
  normalizeSelections,
  normalizeMerchandiseSelections,
  selectionsFromLineItems,
  merchandiseSelectionsFromLineItems,
  sumLineTotalsByKind,
  type CalculatedLineItem,
} from '../domain/pricing/calculateOrder';
import { diffSelections, diffMerchandiseSelections } from '../domain/pricing/auditDiff';
import { listActiveProductsForOrganization } from './merchandiseService';
import { listPaymentRecordsForCase } from './paymentsService';
import { mapWixCaseWriteOffItem, type WixCaseWriteOffItem } from '../lib/wixCaseWriteOffMapper';
import { caseWriteOffFixtures } from './__mocks__/ledgerFixtures';
import { recordCaseOrderChanged, recordJournalEntryPosted } from './activityService';
import { createAndPostJournalEntry, type NewJournalEntryLineInput } from './generalLedgerService';
import { getAccountByNumber, seedChartOfAccounts } from './chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import {
  serviceCatalogFixtures,
  caseOrderFixtures,
  caseOrderLineItemFixtures,
  caseOrderAuditFixtures,
} from './__mocks__/pricingFixtures';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Beacon's
 * pricing engine's orchestration/persistence layer — see
 * docs/adr/ADR-023-case-order-pricing-engine.md. All arithmetic lives in
 * domain/pricing/ (pure, shareable with the browser's live-preview
 * summary); everything here is I/O — fetching the catalog, persisting
 * CaseOrders/line items/audit entries, and computing balances from real
 * PaymentRecord history (reusing services/paymentsService.ts, never
 * duplicating its logic — "Do not duplicate pricing logic").
 *
 * Same organization-scoped, dataAdapterMode-branching shape as every other
 * service in this codebase.
 */

export { calculateAdjustment, calculateBalance };

/** Re-exported/re-normalized here so a caller only ever needs to import
    from this one service module for the "calculateTotals" responsibility
    the phase's own spec names — normalizes untrusted selections before
    calculating, exactly like createCaseOrder/recalculateOrder do. */
export function calculateTotals(catalog: ServiceCatalogItem[], rawSelections: unknown) {
  const selections = normalizeSelections((rawSelections ?? {}) as Record<string, unknown>);
  return calculateOrderTotals(catalog, selections);
}

export async function getServiceCatalog(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  options: { includeInactive?: boolean } = {},
): Promise<ServiceCatalogItem[]> {
  let items: ServiceCatalogItem[];
  if (dataAdapterMode === 'mock') {
    items = serviceCatalogFixtures.filter((item) => item.organizationId === organizationId);
  } else {
    const response = await queryWixDataItems<WixServiceCatalogItem>('serviceCatalog', {
      filter: { organizationId },
    });
    items = response.dataItems
      .map((item) => mapWixServiceCatalogItem(item.data))
      .filter((item): item is ServiceCatalogItem => item !== null);
  }
  const filtered = options.includeInactive ? items : items.filter((item) => item.isActive);
  return filtered.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getActiveCaseOrder(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder | null> {
  if (dataAdapterMode === 'mock') {
    return (
      caseOrderFixtures.find(
        (o) => o.organizationId === organizationId && o.caseId === caseId && o.status === 'active',
      ) ?? null
    );
  }
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, caseId, status: 'active' },
    paging: { limit: 1 },
  });
  return mapWixCaseOrderItem(response.dataItems[0]?.data);
}

/**
 * Phase 31 (Financial Management & General Ledger). Every active
 * `CaseOrder` org-wide, regardless of which case it belongs to — the
 * access pattern `services/financialReportsService.ts#getArAgingReport`
 * needs (every current caller looks up by a known `caseId`; this is the
 * one org-wide query). Relies on the `(organizationId, status)` index
 * added to `caseOrders` for this phase (see
 * docs/adr/ADR-035-financial-management-and-general-ledger.md's
 * conflict #5).
 */
export async function listActiveCaseOrdersForOrganization(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder[]> {
  if (dataAdapterMode === 'mock') {
    return caseOrderFixtures.filter((o) => o.organizationId === organizationId && o.status === 'active');
  }
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', { filter: { organizationId, status: 'active' } });
  return response.dataItems.map((item) => mapWixCaseOrderItem(item.data)).filter((o): o is CaseOrder => o !== null);
}

export async function listCaseOrderVersions(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder[]> {
  if (dataAdapterMode === 'mock') {
    return caseOrderFixtures
      .filter((o) => o.organizationId === organizationId && o.caseId === caseId)
      .sort((a, b) => b.version - a.version);
  }
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, caseId },
  });
  return response.dataItems
    .map((item) => mapWixCaseOrderItem(item.data))
    .filter((o): o is CaseOrder => o !== null)
    .sort((a, b) => b.version - a.version);
}

export async function listLineItemsForOrder(
  organizationId: string,
  caseOrderId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrderLineItem[]> {
  if (dataAdapterMode === 'mock') {
    return caseOrderLineItemFixtures
      .filter((li) => li.organizationId === organizationId && li.caseOrderId === caseOrderId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const response = await queryWixDataItems<WixCaseOrderLineItemItem>('caseOrderLineItems', {
    filter: { organizationId, caseOrderId },
  });
  return response.dataItems
    .map((item) => mapWixCaseOrderLineItemItem(item.data))
    .filter((li): li is CaseOrderLineItem => li !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Phase 35 (Merchandise, Inventory & Commerce). The merchandise selections a
 * case's active order currently represents — read by the case-merchandise
 * route to merge in an add/remove before recalculating. Reconstructed from
 * the persisted line items (never a parallel stored blob), so it can never
 * diverge from the authoritative order.
 */
export async function listMerchandiseSelectionsForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<MerchandiseSelection[]> {
  const order = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
  if (!order) return [];
  const lineItems = await listLineItemsForOrder(organizationId, order.id, dataAdapterMode);
  return merchandiseSelectionsFromLineItems(lineItems);
}

export async function listAuditEntriesForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrderAuditEntry[]> {
  if (dataAdapterMode === 'mock') {
    return caseOrderAuditFixtures
      .filter((e) => e.organizationId === organizationId && e.caseId === caseId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  const response = await queryWixDataItems<WixCaseOrderAuditItem>('caseOrderAuditEntries', {
    filter: { organizationId, caseId },
  });
  return response.dataItems
    .map((item) => mapWixCaseOrderAuditItem(item.data))
    .filter((e): e is CaseOrderAuditEntry => e !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Sum of every 'succeeded' PaymentRecord for this case, across every
    CaseOrder version it has ever had — the one place "how much has this
    case actually been paid" is computed, reused by both createCaseOrder's
    balance seed (always 0 for a brand-new case, but computed the same way
    for consistency) and recalculateOrder's balance refresh. */
export async function getPaidAmountForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<number> {
  const payments = await listPaymentRecordsForCase(organizationId, caseId, dataAdapterMode);
  return payments.filter((p) => p.status === 'succeeded').reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Reads directly rather than importing from services/financialTransactionService.ts
 * (which owns caseWriteOffs' one write path) — that service in turn calls
 * `refreshBalanceForCase` below for `postRefundTransaction`, so this file
 * doing its own read here (mirroring how it already reads caseOrders/
 * caseOrderLineItems directly) keeps the dependency one-directional
 * instead of a cycle.
 */
async function getWriteOffTotalForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<number> {
  if (dataAdapterMode === 'mock') {
    return caseWriteOffFixtures
      .filter((w) => w.organizationId === organizationId && w.caseId === caseId)
      .reduce((sum, w) => sum + w.amount, 0);
  }
  const response = await queryWixDataItems<WixCaseWriteOffItem>('caseWriteOffs', { filter: { organizationId, caseId } });
  return response.dataItems
    .map((item) => mapWixCaseWriteOffItem(item.data))
    .filter((w): w is NonNullable<typeof w> => w !== null)
    .reduce((sum, w) => sum + w.amount, 0);
}

/**
 * Phase 31 (Financial Management & General Ledger). `getPaidAmountForCase`
 * plus every write-off ever posted for this case — without this, a
 * written-off case would keep showing a nonzero `balanceDue` forever,
 * since `getPaidAmountForCase` only ever counts `succeeded` payments and
 * has no concept of "forgiven." Used exclusively by
 * `refreshBalanceForCase` (see its own comment on why
 * `recalculateOrder` intentionally keeps using `getPaidAmountForCase`
 * directly instead) — see
 * docs/adr/ADR-035-financial-management-and-general-ledger.md.
 */
export async function getSatisfiedAmountForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<number> {
  const paidAmount = await getPaidAmountForCase(organizationId, caseId, dataAdapterMode);
  const writeOffTotal = await getWriteOffTotalForCase(organizationId, caseId, dataAdapterMode);
  return paidAmount + writeOffTotal;
}

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). Closes a real
 * Phase 31 gap: no transaction ever credited Service Revenue (4000) —
 * `grep -rn "SERVICE_REVENUE" services/ domain/` returns exactly one hit,
 * the constant's own definition. Payment posting only ever credits
 * Accounts Receivable (never independently debits it first), so AR ran
 * permanently negative and Revenue/P&L were structurally always $0 the
 * moment any tenant had real payment history. This is the one place
 * Phase 32 touches Phase 31's core ledger — everything else in this
 * phase is additive-only reporting.
 *
 * Dr Accounts Receivable / Cr Service Revenue for the full `total` on
 * initial creation; for a recalculation, only the **net delta** posts
 * (direction flips if the new total is lower), so re-pricing never
 * double-counts revenue already recognized. A zero delta posts nothing —
 * `assertJournalEntryBalances` rejects zero-amount lines regardless, so
 * this is a natural early-return, not a special case.
 *
 * Auto-seeds the chart of accounts if it doesn't exist yet for this
 * organization (idempotent — `seedChartOfAccounts` no-ops once seeded)
 * rather than throwing: revenue recognition must never be silently
 * skipped, but every one of this file's existing callers/tests predates
 * this phase and doesn't know to seed the chart of accounts first, and a
 * hard failure here would block case-order creation for any of them.
 *
 * Deliberately calls `generalLedgerService.createAndPostJournalEntry` and
 * `chartOfAccountsService.getAccountByNumber` directly rather than
 * routing through `services/financialTransactionService.ts` — Phase 31
 * established `financialTransactionService.ts -> pricingService.ts` as
 * one-directional (the former calls `refreshBalanceForCase`); routing a
 * new pricingService->financialTransactionService call would create a
 * cycle. Calling the same low-level ledger primitives
 * `financialTransactionService.ts` itself depends on keeps this file a
 * peer consumer of the ledger, not a new link in an existing cycle.
 */
async function postRevenueRecognition(
  organizationId: string,
  caseId: string,
  serviceDelta: number,
  merchandiseDelta: number,
  actorIdentityId: string | null,
  idFactory: () => string,
  now: string,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  if (serviceDelta === 0 && merchandiseDelta === 0) return;

  // Resolve the three accounts this split touches — Accounts Receivable
  // (1200), Service Revenue (4000), Merchandise Revenue (4100). Only look up
  // the merchandise account when there's a merchandise delta, so a pure
  // service org still works identically even before its chart gains 4100.
  const resolve = () =>
    Promise.all([
      getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, dataAdapterMode),
      getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.SERVICE_REVENUE, dataAdapterMode),
      merchandiseDelta !== 0
        ? getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.MERCHANDISE_REVENUE, dataAdapterMode)
        : Promise.resolve(null),
    ]);
  let [accountsReceivable, serviceRevenue, merchandiseRevenue] = await resolve();
  if (!accountsReceivable || !serviceRevenue || (merchandiseDelta !== 0 && !merchandiseRevenue)) {
    await seedChartOfAccounts(organizationId, idFactory, dataAdapterMode);
    [accountsReceivable, serviceRevenue, merchandiseRevenue] = await resolve();
  }
  if (!accountsReceivable || !serviceRevenue || (merchandiseDelta !== 0 && !merchandiseRevenue)) {
    throw new Error(`Failed to resolve required ledger accounts for organization "${organizationId}" even after seeding.`);
  }

  // One balanced entry: Dr/Cr Accounts Receivable for the NET delta, plus a
  // separate Cr/Dr line per revenue account for its own signed delta. A
  // positive delta credits revenue (asset up → Dr AR); a negative delta
  // debits it. A zero delta contributes no line. Because
  // net = serviceDelta + merchandiseDelta, the AR line always balances the
  // revenue lines regardless of sign combination (assertJournalEntryBalances
  // is the backstop). Merchandise revenue is credited to 4100, kept fully
  // separate from Service Revenue (4000) — ADR-039 decision 2.
  const net = serviceDelta + merchandiseDelta;
  const lines: NewJournalEntryLineInput[] = [];
  if (net !== 0) {
    lines.push({ accountId: accountsReceivable.id, direction: net > 0 ? 'debit' : 'credit', amount: Math.abs(net), caseId });
  }
  if (serviceDelta !== 0) {
    lines.push({ accountId: serviceRevenue.id, direction: serviceDelta > 0 ? 'credit' : 'debit', amount: Math.abs(serviceDelta), caseId });
  }
  if (merchandiseDelta !== 0 && merchandiseRevenue) {
    lines.push({ accountId: merchandiseRevenue.id, direction: merchandiseDelta > 0 ? 'credit' : 'debit', amount: Math.abs(merchandiseDelta), caseId });
  }

  const { entry } = await createAndPostJournalEntry(
    organizationId,
    {
      entryDate: now,
      sourceType: 'revenue_recognition',
      caseId,
      memo: `Revenue recognition for case ${caseId} (service ${serviceDelta}, merchandise ${merchandiseDelta})`,
      lines,
      idFactory,
      now,
    },
    dataAdapterMode,
  );

  try {
    await recordJournalEntryPosted(
      { organizationId, actorIdentityId, actorMembershipId: null, actorRoleKey: null, correlationId: entry.id },
      caseId,
      entry.id,
      entry.entryNumber,
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record journal.entry.posted activity event for revenue recognition:', error instanceof Error ? error.message : error);
  }
}

async function persistCaseOrder(order: CaseOrder, dataAdapterMode: DataAdapterMode): Promise<CaseOrder> {
  if (dataAdapterMode === 'mock') {
    caseOrderFixtures.push(order);
    return order;
  }
  const inserted = await insertWixDataItem<WixCaseOrderItem>('caseOrders', buildWixCaseOrderData(order), order.id);
  const mapped = mapWixCaseOrderItem(inserted.data);
  if (!mapped) throw new Error('Failed to create case order.');
  return mapped;
}

async function persistLineItems(lineItems: CaseOrderLineItem[], dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    caseOrderLineItemFixtures.push(...lineItems);
    return;
  }
  for (const lineItem of lineItems) {
    await insertWixDataItem<WixCaseOrderLineItemItem>(
      'caseOrderLineItems',
      buildWixCaseOrderLineItemData(lineItem),
      lineItem.id,
    );
  }
}

async function persistAuditEntries(entries: CaseOrderAuditEntry[], dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    caseOrderAuditFixtures.push(...entries);
    return;
  }
  for (const entry of entries) {
    await insertWixDataItem<WixCaseOrderAuditItem>('caseOrderAuditEntries', buildWixCaseOrderAuditData(entry), entry.id);
  }
}

async function markCaseOrderSuperseded(
  organizationId: string,
  caseOrderId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (dataAdapterMode === 'mock') {
    const index = caseOrderFixtures.findIndex((o) => o.organizationId === organizationId && o.id === caseOrderId);
    if (index !== -1) caseOrderFixtures[index] = { ...caseOrderFixtures[index], status: 'superseded', updatedAt: nowIso };
    return;
  }
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, beaconCaseOrderId: caseOrderId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;
  const mergedData = applyCaseOrderUpdateToWixData(existingItem.data, { status: 'superseded', updatedAt: nowIso });
  await updateWixDataItem('caseOrders', existingItem.id, mergedData);
}

function buildLineItems(
  organizationId: string,
  caseOrderId: string,
  calculatedLineItems: CalculatedLineItem[],
  nowIso: string,
  idFactory: () => string,
): CaseOrderLineItem[] {
  return calculatedLineItems.map((item) => ({
    id: idFactory(),
    organizationId,
    caseOrderId,
    lineKind: item.lineKind,
    serviceCode: item.serviceCode,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
    sortOrder: item.sortOrder,
    metadata: item.metadata,
    createdAt: nowIso,
  }));
}

/** The merchandise catalog used for pricing — active products only, exactly
    as `getServiceCatalog` fetches active service rows. Reuses
    merchandiseService's read (never a parallel query). */
function getMerchandiseCatalogForPricing(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<MerchandiseProduct[]> {
  return listActiveProductsForOrganization(organizationId, dataAdapterMode);
}

/**
 * Resolves the service half of an order's selections from a raw request
 * body, carrying the current selection forward when the caller doesn't
 * provide one (so a merchandise-only edit never wipes services, and vice
 * versa). Supports both a nested `{ services: {...} }` and the legacy flat
 * `{ weightTier, ... }` shape every pre-Phase-35 caller uses.
 */
function extractServiceSelections(raw: unknown, currentLineItems: CaseOrderLineItem[] | null): ServiceSelections {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (obj.services && typeof obj.services === 'object') return normalizeSelections(obj.services as Record<string, unknown>);
  const hasFlatServiceFields = 'weightTier' in obj || 'extraDeathCertificateQuantity' in obj || 'mailCremated' in obj;
  if (hasFlatServiceFields) return normalizeSelections(obj);
  if (currentLineItems) return selectionsFromLineItems(currentLineItems);
  return normalizeSelections({});
}

/** The merchandise half — carries current merchandise forward when the
    caller doesn't provide a `merchandise` array. */
function extractMerchandiseSelections(raw: unknown, currentLineItems: CaseOrderLineItem[] | null): MerchandiseSelection[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if ('merchandise' in obj) return normalizeMerchandiseSelections(obj.merchandise);
  if (currentLineItems) return merchandiseSelectionsFromLineItems(currentLineItems);
  return [];
}

/**
 * Creates a case's first CaseOrder (version 1) from staff-submitted
 * selections — never a submitted total. Always re-fetches the catalog and
 * recalculates server-side (see domain/pricing/calculateOrder.ts). Writes
 * one 'order_created' audit entry so every case's pricing history starts
 * from a real, timestamped record, not an implicit zero state.
 */
export async function createCaseOrder(
  params: {
    organizationId: string;
    caseId: string;
    selections: unknown;
    performedBy: string;
    idFactory: () => string;
    now?: string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<{ order: CaseOrder; lineItems: CaseOrderLineItem[]; auditEntry: CaseOrderAuditEntry }> {
  const nowIso = params.now ?? new Date().toISOString();
  const catalog = await getServiceCatalog(params.organizationId, dataAdapterMode);
  const products = await getMerchandiseCatalogForPricing(params.organizationId, dataAdapterMode);
  const orderSelections = {
    services: extractServiceSelections(params.selections, null),
    merchandise: extractMerchandiseSelections(params.selections, null),
  };
  const calculated = calculateOrderTotalsWithMerchandise(catalog, products, orderSelections);

  const orderId = params.idFactory();
  const order: CaseOrder = {
    id: orderId,
    organizationId: params.organizationId,
    caseId: params.caseId,
    status: 'active',
    subtotal: calculated.subtotal,
    discountTotal: calculated.discountTotal,
    taxTotal: calculated.taxTotal,
    total: calculated.total,
    balanceDue: calculateBalance(calculated.total, 0),
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const lineItems = buildLineItems(params.organizationId, orderId, calculated.lineItems, nowIso, params.idFactory);
  const split = sumLineTotalsByKind(calculated.lineItems);
  const serviceCount = calculated.lineItems.filter((li) => li.lineKind === 'service').length;
  const merchandiseCount = calculated.lineItems.filter((li) => li.lineKind === 'merchandise').length;

  const auditEntry: CaseOrderAuditEntry = {
    id: params.idFactory(),
    organizationId: params.organizationId,
    caseId: params.caseId,
    caseOrderId: orderId,
    action: 'order_created',
    previousValue: null,
    newValue: null,
    amountDeltaCents: calculated.total,
    description: `Case order created — ${serviceCount} service${serviceCount === 1 ? '' : 's'}${merchandiseCount > 0 ? `, ${merchandiseCount} merchandise item${merchandiseCount === 1 ? '' : 's'}` : ''}`,
    performedBy: params.performedBy,
    createdAt: nowIso,
  };

  const persistedOrder = await persistCaseOrder(order, dataAdapterMode);
  await persistLineItems(lineItems, dataAdapterMode);
  await persistAuditEntries([auditEntry], dataAdapterMode);

  // Recognize revenue split by kind (service → 4000, merchandise → 4100).
  await postRevenueRecognition(params.organizationId, params.caseId, split.service, split.merchandise, params.performedBy, params.idFactory, nowIso, dataAdapterMode);

  return { order: persistedOrder, lineItems, auditEntry };
}

/**
 * Edits a case's services: supersedes the current active CaseOrder,
 * creates a new version reflecting the new selections, and appends one
 * audit entry per individual change (weight tier / death certificate
 * quantity / mail cremated remains). Returns null if the case has no
 * active CaseOrder to edit (callers should treat this as 404, not a silent
 * create — editing is distinct from initial creation). Returns the
 * unchanged current order (no new version, no audit entries) if the new
 * selections are identical to the current ones — a no-op edit should never
 * pollute the version/audit history.
 */
export async function recalculateOrder(
  params: {
    organizationId: string;
    caseId: string;
    selections: unknown;
    performedBy: string;
    idFactory: () => string;
    now?: string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<{ order: CaseOrder; lineItems: CaseOrderLineItem[]; auditEntries: CaseOrderAuditEntry[] } | null> {
  const current = await getActiveCaseOrder(params.organizationId, params.caseId, dataAdapterMode);
  if (!current) return null;

  const nowIso = params.now ?? new Date().toISOString();
  const catalog = await getServiceCatalog(params.organizationId, dataAdapterMode);
  const products = await getMerchandiseCatalogForPricing(params.organizationId, dataAdapterMode);
  const currentLineItems = await listLineItemsForOrder(params.organizationId, current.id, dataAdapterMode);

  // Reconstruct BOTH dimensions from the current order, then apply only what
  // the caller changed — a service-only edit carries merchandise forward
  // unchanged, and a merchandise-only edit carries services forward.
  const previousServices = selectionsFromLineItems(currentLineItems);
  const previousMerchandise = merchandiseSelectionsFromLineItems(currentLineItems);
  const nextServices = extractServiceSelections(params.selections, currentLineItems);
  const nextMerchandise = extractMerchandiseSelections(params.selections, currentLineItems);

  const serviceDiff = diffSelections(catalog, previousServices, nextServices);
  const merchandiseDiff = diffMerchandiseSelections(products, previousMerchandise, nextMerchandise);
  const diffEntries = [...serviceDiff, ...merchandiseDiff];
  if (diffEntries.length === 0) {
    return { order: current, lineItems: currentLineItems, auditEntries: [] };
  }

  const calculated = calculateOrderTotalsWithMerchandise(catalog, products, { services: nextServices, merchandise: nextMerchandise });
  const paidAmount = await getPaidAmountForCase(params.organizationId, params.caseId, dataAdapterMode);

  const newOrderId = params.idFactory();
  const newOrder: CaseOrder = {
    id: newOrderId,
    organizationId: params.organizationId,
    caseId: params.caseId,
    status: 'active',
    subtotal: calculated.subtotal,
    discountTotal: calculated.discountTotal,
    taxTotal: calculated.taxTotal,
    total: calculated.total,
    balanceDue: calculateBalance(calculated.total, paidAmount),
    version: current.version + 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const newLineItems = buildLineItems(params.organizationId, newOrderId, calculated.lineItems, nowIso, params.idFactory);

  const auditEntries: CaseOrderAuditEntry[] = diffEntries.map((entry) => ({
    id: params.idFactory(),
    organizationId: params.organizationId,
    caseId: params.caseId,
    caseOrderId: newOrderId,
    action: entry.action,
    previousValue: entry.previousValue,
    newValue: entry.newValue,
    amountDeltaCents: entry.amountDeltaCents,
    description: entry.description,
    performedBy: params.performedBy,
    createdAt: nowIso,
  }));

  await markCaseOrderSuperseded(params.organizationId, current.id, dataAdapterMode);
  const persistedOrder = await persistCaseOrder(newOrder, dataAdapterMode);
  await persistLineItems(newLineItems, dataAdapterMode);
  await persistAuditEntries(auditEntries, dataAdapterMode);

  // Post only the NET change per revenue kind — service delta to 4000,
  // merchandise delta to 4100 — so repricing never re-recognizes revenue
  // already booked, and merchandise revenue never leaks into service revenue.
  const newSplit = sumLineTotalsByKind(calculated.lineItems);
  const oldSplit = sumLineTotalsByKind(currentLineItems);
  const serviceDelta = newSplit.service - oldSplit.service;
  const merchandiseDelta = newSplit.merchandise - oldSplit.merchandise;
  await postRevenueRecognition(params.organizationId, params.caseId, serviceDelta, merchandiseDelta, params.performedBy, params.idFactory, nowIso, dataAdapterMode);

  // Phase 24 (Case Activity Timeline & Audit Center): one activity event
  // summarizing this whole recalculation, reusing the exact diff data
  // already computed above — best-effort, never fails the actual order
  // update. `performedBy` carries no resolved membership/role here (this
  // service has no auth context of its own — see this file's own
  // "no new authorization logic" convention), so those two fields are null.
  try {
    await recordCaseOrderChanged(
      { organizationId: params.organizationId, actorIdentityId: params.performedBy, actorMembershipId: null, actorRoleKey: null, correlationId: newOrderId },
      params.caseId,
      newOrderId,
      diffEntries,
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record case.order.changed activity event:', error instanceof Error ? error.message : error);
  }

  return { order: persistedOrder, lineItems: newLineItems, auditEntries };
}

/**
 * Refreshes only balanceDue on the case's current active CaseOrder — used
 * after a payment succeeds (paymentWorkflow.ts), never touches subtotal/
 * total/version/status. Never creates a new version — a payment is not an
 * edit to what was ordered.
 *
 * Phase 31: uses `getSatisfiedAmountForCase` (paid + written-off), not
 * plain `getPaidAmountForCase` — otherwise a written-off case would keep
 * showing a nonzero balance forever. `recalculateOrder` above
 * deliberately keeps using `getPaidAmountForCase` directly: a brand-new
 * order version has no write-offs against it yet by definition (a
 * write-off always targets an already-settled balance), so pulling in
 * the extra query there would be a no-op that only adds a Wix round trip.
 */
export async function refreshBalanceForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder | null> {
  const order = await getActiveCaseOrder(organizationId, caseId, dataAdapterMode);
  if (!order) return null;
  const paidAmount = await getSatisfiedAmountForCase(organizationId, caseId, dataAdapterMode);
  const balanceDue = calculateBalance(order.total, paidAmount);
  if (balanceDue === order.balanceDue) return order;

  const nowIso = new Date().toISOString();
  if (dataAdapterMode === 'mock') {
    const index = caseOrderFixtures.findIndex((o) => o.organizationId === organizationId && o.id === order.id);
    if (index !== -1) caseOrderFixtures[index] = { ...caseOrderFixtures[index], balanceDue, updatedAt: nowIso };
    return caseOrderFixtures[index] ?? null;
  }

  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, beaconCaseOrderId: order.id },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const mergedData = applyCaseOrderUpdateToWixData(existingItem.data, { balanceDue, updatedAt: nowIso });
  const updated = await updateWixDataItem<WixCaseOrderItem>('caseOrders', existingItem.id, mergedData);
  return mapWixCaseOrderItem(updated.data);
}
