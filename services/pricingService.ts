import type { DataAdapterMode } from '../lib/env';
import { isOrderLinePriceLocked } from '../domain/pricing/pricingPermissions';
import { beginCatalogPriceChange, CatalogPriceConflictError, settleCatalogPriceChange, settleFromItem } from './catalogPriceChangeJournal';
import { formatCentsAsCurrency } from '../utils/format';
import { queryWixDataItems, queryAllWixDataItems, insertWixDataItem, conditionalPatchWixDataItemFields } from '../lib/wixDataApi';
import {
  mapWixServiceCatalogItem,
  type WixServiceCatalogItem,
} from '../lib/wixServiceCatalogMapper';
import {
  mapWixCaseOrderItem,
  buildWixCaseOrderData,
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
import type { CaseOrder, CaseOrderLineItem, ServiceSelections, MerchandiseSelection, CustomLineItemSelection } from '../types/caseOrder';
import type { CaseOrderAuditEntry } from '../types/caseOrderAudit';
import type { MerchandiseProduct } from '../types/merchandiseProduct';
import {
  calculateAdjustment,
  calculateBalance,
  calculateOrderTotals,
  normalizeSelections,
  normalizeMerchandiseSelections,
  normalizeCustomItemSelections,
  selectionsFromLineItems,
  merchandiseSelectionsFromLineItems,
  customItemSelectionsFromLineItems,
  calculateCustomLineItems,
  sumLineTotalsByKind,
  MERCHANDISE_SORT_BASE,
  resolveServiceTypeCode,
  type CalculatedLineItem,
  type CalculatedOrderTotals,
  type UnpricedSelectedItem,
  catalogItemSelectionsFromLineItems,
  catalogWithOrderSnapshots,
  catalogForCaseServiceType,
} from '../domain/pricing/calculateOrder';
import { getMerchandiseCategoryDefinition } from '../domain/merchandise/merchandiseCategoryRegistry';
import { resolveVariantEconomics } from '../domain/merchandise/variantEconomics';
import { diffSelections, diffMerchandiseSelections, diffCustomItemSelections } from '../domain/pricing/auditDiff';
import { listActiveProductsForOrganization, getVariantById } from './merchandiseService';
import { listPaymentRecordsForCase } from './paymentsService';
import { mapWixCaseWriteOffItem, type WixCaseWriteOffItem } from '../lib/wixCaseWriteOffMapper';
import { caseWriteOffFixtures } from './__mocks__/ledgerFixtures';
import { recordCaseOrderChanged, recordJournalEntryPosted, recordServiceCatalogPriceUpdated, type ActivityContext } from './activityService';
import { completePartiallyPostedEntryLines, createAndPostJournalEntry, getJournalEntryWithLines, listJournalEntriesForCase, type NewJournalEntryLineInput } from './generalLedgerService';
import {
  ORDER_OPERATION_INTERRUPTED_AFTER_MS,
  orderRevenueReference,
  recordOrderOperationJournal,
  recordOrderOperationJournalBestEffort,
  type OrderOperationKind,
  type OrderOperationStatus,
  type OrderOperationDetails,
} from './orderOperationJournal';
import { getAccountByNumber, seedChartOfAccounts } from './chartOfAccountsService';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';
import {
  serviceCatalogFixtures,
  caseOrderFixtures,
  caseOrderLineItemFixtures,
  caseOrderAuditFixtures,
} from './__mocks__/pricingFixtures';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Solis's
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

/**
 * 2026-10 (Gus Camacho Jr. service catalog). Thrown by createCaseOrder/
 * recalculateOrder BEFORE anything is persisted when the order's selected
 * items include one whose catalog price isn't set (`defaultPrice: null`) —
 * the server never saves an order line at an invented amount, and never
 * silently drops a service staff explicitly chose. Routes map this to 422
 * with `message`, which tells staff exactly what to do about it.
 */
export class UnpricedCatalogItemError extends Error {
  readonly unpricedItems: UnpricedSelectedItem[];
  constructor(unpricedItems: UnpricedSelectedItem[]) {
    const names = unpricedItems.map((item) => `"${item.displayName}"`).join(', ');
    super(
      `No price is set for ${names}. An administrator must set ${unpricedItems.length === 1 ? 'its price' : 'their prices'} in Settings › Price Catalog before ${unpricedItems.length === 1 ? 'it' : 'they'} can be added to a case order.`,
    );
    this.name = 'UnpricedCatalogItemError';
    this.unpricedItems = unpricedItems;
  }
}

function assertNoUnpricedItems(calculated: CalculatedOrderTotals): void {
  if (calculated.unpricedItems.length > 0) throw new UnpricedCatalogItemError(calculated.unpricedItems);
}

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
    const rows = await queryAllWixDataItems<WixServiceCatalogItem>('serviceCatalog', { organizationId });
    items = rows
      .map((item) => mapWixServiceCatalogItem(item.data))
      .filter((item): item is ServiceCatalogItem => item !== null);
  }
  const filtered = options.includeInactive ? items : items.filter((item) => item.isActive);
  return filtered.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Non-destructive order versioning (2026-10). Which of a case's rows is THE
 * active order, decided the same way everywhere. Exactly one row per case
 * should be `active`; if a crash or a legacy write ever left more than one,
 * the answer is still deterministic — never "whichever the query returned
 * first": the highest `version`, then the earliest `createdAt`, then the
 * lowest id. The ambiguity is logged (ids only, never amounts) so it can be
 * repaired by hand. Pure — exported for tests.
 */
export function pickActiveCaseOrder(candidates: CaseOrder[]): CaseOrder | null {
  const active = candidates.filter((order) => order.status === 'active');
  if (active.length === 0) return null;
  const [chosen] = [...active].sort(
    (a, b) => b.version - a.version || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  if (active.length > 1) {
    console.warn(
      `[caseOrders] case ${chosen.caseId} (organization ${chosen.organizationId}) has ${active.length} active order rows (${active.map((o) => `${o.id} v${o.version}`).join(', ')}); using ${chosen.id}. Review the case order history.`,
    );
  }
  return chosen;
}

/** How many active rows one case lookup reads — far more than the one that
    should exist, so an ambiguity is always seen rather than truncated. */
const ACTIVE_ORDER_LOOKUP_LIMIT = 50;

export async function getActiveCaseOrder(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder | null> {
  if (dataAdapterMode === 'mock') {
    return pickActiveCaseOrder(
      caseOrderFixtures.filter((o) => o.organizationId === organizationId && o.caseId === caseId && o.status === 'active'),
    );
  }
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, caseId, status: 'active' },
    paging: { limit: ACTIVE_ORDER_LOOKUP_LIMIT },
  });
  return pickActiveCaseOrder(
    response.dataItems
      .map((item) => mapWixCaseOrderItem(item.data))
      // Defense in depth: never trust the backend's filter alone.
      .filter((o): o is CaseOrder => o !== null && o.organizationId === organizationId && o.caseId === caseId),
  );
}

/** One active order per case (pickActiveCaseOrder's rule) — so an org-wide
    report never counts a case twice if it ever had two active rows. */
function activeOrderPerCase(orders: CaseOrder[]): CaseOrder[] {
  const byCase = new Map<string, CaseOrder[]>();
  for (const order of orders) byCase.set(order.caseId, [...(byCase.get(order.caseId) ?? []), order]);
  return [...byCase.values()].map((rows) => pickActiveCaseOrder(rows)).filter((o): o is CaseOrder => o !== null);
}

/**
 * Phase 31 (Financial Management & General Ledger). Every active
 * `CaseOrder` org-wide, regardless of which case it belongs to — the
 * access pattern `services/financialReportsService.ts#getArAgingReport`
 * needs (every current caller looks up by a known `caseId`; this is the
 * one org-wide query). Relies on the `(organizationId, status)` index
 * added to `caseOrders` for this phase (see
 * docs/adr/ADR-035-financial-management-and-general-ledger.md's
 * conflict #5). 2026-10: at most one row per case (activeOrderPerCase).
 */
export async function listActiveCaseOrdersForOrganization(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder[]> {
  let active: CaseOrder[];
  let pending: CaseOrder[];
  if (dataAdapterMode === 'mock') {
    active = caseOrderFixtures.filter((o) => o.organizationId === organizationId && o.status === 'active');
    pending = caseOrderFixtures.filter((o) => o.organizationId === organizationId && o.status === 'pending');
  } else {
    const [activeItems, pendingItems] = await Promise.all([
      queryAllWixDataItems<WixCaseOrderItem>('caseOrders', { organizationId, status: 'active' }),
      queryAllWixDataItems<WixCaseOrderItem>('caseOrders', { organizationId, status: 'pending' }),
    ]);
    const map = (items: Array<{ data: WixCaseOrderItem }>) =>
      items.map((item) => mapWixCaseOrderItem(item.data)).filter((o): o is CaseOrder => o !== null && o.organizationId === organizationId);
    active = map(activeItems);
    pending = map(pendingItems);
  }
  const orders = activeOrderPerCase(active);
  if (pending.length === 0) return orders;

  // Interrupted order edits (2026-10): a case with an unfinished change is
  // reported by its EFFECTIVE order (resolveCaseOrderState), flagged —
  // never silently dropped from AR / reports as if it owed nothing.
  const interruptedCaseIds = [...new Set(pending.map((o) => o.caseId))];
  const byCase = new Map(orders.map((o) => [o.caseId, o]));
  for (const caseId of interruptedCaseIds) {
    const { effective } = await getCaseOrderState(organizationId, caseId, dataAdapterMode);
    if (effective) byCase.set(caseId, effective);
  }
  return [...byCase.values()];
}

/**
 * Interrupted order edits (2026-10, Phase 5A.2). EVERY stored row of one
 * case, whatever its status — including `pending` versions an unfinished
 * change wrote and `withdrawn` ones that never took effect. Only the
 * order-operation machinery (locking, inspection, repair) reads these;
 * everything that bills or lists versions uses listCaseOrderVersions.
 */
export async function listAllCaseOrderRows(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder[]> {
  if (dataAdapterMode === 'mock') {
    return caseOrderFixtures
      .filter((o) => o.organizationId === organizationId && o.caseId === caseId)
      .sort((a, b) => b.version - a.version);
  }
  const items = await queryAllWixDataItems<WixCaseOrderItem>('caseOrders', { organizationId, caseId });
  return items
    .map((item) => mapWixCaseOrderItem(item.data))
    .filter((o): o is CaseOrder => o !== null && o.organizationId === organizationId && o.caseId === caseId)
    .sort((a, b) => b.version - a.version);
}

/** A version that is or was the case's order — `pending` and `withdrawn`
    rows never were, so they are never billed or listed as a version. */
function isBillableVersion(order: CaseOrder): boolean {
  return order.status === 'active' || order.status === 'superseded';
}

export async function listCaseOrderVersions(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder[]> {
  return (await listAllCaseOrderRows(organizationId, caseId, dataAdapterMode)).filter(isBillableVersion);
}

// ---------------------------------------------------------------------------
// Interrupted order edits (2026-10, Phase 5A.2 — docs/ORDER_VERSIONING.md).
// An order change writes its new version as `pending` first and makes it
// `active` last. A `pending` row is therefore the durable mark of a change
// that has not finished — in flight for a moment, or interrupted by a
// crash. While one exists the case's order is LOCKED: creating, editing
// and collecting payment are refused (never a fresh order replacing lost
// billing lines), and reads resolve the case's billing deterministically.
// ---------------------------------------------------------------------------

export type CaseOrderInterruption = {
  /** The unfinished version (its id is also the operation id). */
  pendingOrderId: string;
  /** The version it is meant to replace (null: the case's first order). */
  previousOrderId: string | null;
  since: string;
  /** Older than any live request: it needs an administrator, not a retry. */
  stale: boolean;
};

export class CaseOrderInterruptedError extends Error {
  readonly interruption: CaseOrderInterruption;
  constructor(interruption: CaseOrderInterruption) {
    super(
      interruption.stale
        ? "This case's services were being changed when the system stopped, so its order is locked until an administrator repairs it. Nothing was changed."
        : "Another change to this case's services is being saved right now. Nothing was changed — try again in a moment.",
    );
    this.name = 'CaseOrderInterruptedError';
    this.interruption = interruption;
  }
}

/** Refused before any write when even the `prepared` journal entry can't be
    recorded — an unjournaled partial order change must never be risked. */
export class CaseOrderJournalUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`The order change could not be started (${cause instanceof Error ? cause.message : 'journal unavailable'}). Nothing was changed — try again.`);
    this.name = 'CaseOrderJournalUnavailableError';
  }
}

/** Pure — the oldest pending row of a case's rows, if any. */
export function findCaseOrderInterruption(rows: CaseOrder[], now: Date = new Date()): CaseOrderInterruption | null {
  const pending = rows.filter((o) => o.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const oldest = pending[0];
  if (!oldest) return null;
  return {
    pendingOrderId: oldest.id,
    previousOrderId: oldest.supersedesOrderId ?? null,
    since: oldest.createdAt,
    stale: now.getTime() - new Date(oldest.createdAt).getTime() >= ORDER_OPERATION_INTERRUPTED_AFTER_MS,
  };
}

export type CaseOrderState = {
  /** The row marked active (normally exactly one; null while none is). */
  active: CaseOrder | null;
  /**
   * What the case is billed for NOW. Normally the active row. While a
   * change is unfinished and has already superseded the version it
   * replaces (so no row is active), it is that superseded version — the
   * one the ledger still reflects (the new version's revenue is posted only
   * after it is activated). Marked `operationInterrupted` whenever a
   * change is unfinished, so a report can flag it rather than show $0.
   */
  effective: CaseOrder | null;
  interruption: CaseOrderInterruption | null;
};

/** Pure — see CaseOrderState. */
export function resolveCaseOrderState(rows: CaseOrder[], now: Date = new Date()): CaseOrderState {
  const active = pickActiveCaseOrder(rows);
  const interruption = findCaseOrderInterruption(rows, now);
  let effective = active;
  if (!effective && interruption?.previousOrderId) {
    const previous = rows.find((o) => o.id === interruption.previousOrderId && o.status === 'superseded') ?? null;
    effective = previous;
  }
  if (effective && interruption) effective = { ...effective, operationInterrupted: true };
  return { active, effective, interruption };
}

export async function getCaseOrderState(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<CaseOrderState> {
  return resolveCaseOrderState(await listAllCaseOrderRows(organizationId, caseId, dataAdapterMode));
}

/** Throws CaseOrderInterruptedError while the case's order is locked by
    an unfinished change. */
export async function assertCaseOrderNotInterrupted(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  const interruption = findCaseOrderInterruption(await listAllCaseOrderRows(organizationId, caseId, dataAdapterMode));
  if (interruption) throw new CaseOrderInterruptedError(interruption);
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
  const items = await queryAllWixDataItems<WixCaseOrderLineItemItem>('caseOrderLineItems', { organizationId, caseOrderId });
  return items
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
  const items = await queryAllWixDataItems<WixCaseOrderAuditItem>('caseOrderAuditEntries', { organizationId, caseId });
  return items
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
export async function getWriteOffTotalForCase(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<number> {
  if (dataAdapterMode === 'mock') {
    return caseWriteOffFixtures
      .filter((w) => w.organizationId === organizationId && w.caseId === caseId)
      .reduce((sum, w) => sum + w.amount, 0);
  }
  const items = await queryAllWixDataItems<WixCaseWriteOffItem>('caseWriteOffs', { organizationId, caseId });
  return items
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
/**
 * The lines of one revenue-recognition entry — resolving (seeding if
 * needed) Accounts Receivable (1200), Service Revenue (4000) and, only when
 * there is a merchandise delta, Merchandise Revenue (4100). One balanced
 * entry: Dr/Cr Accounts Receivable for the NET delta, plus a separate Cr/Dr
 * line per revenue account for its own signed delta. Because net =
 * serviceDelta + merchandiseDelta, the AR line always balances the revenue
 * lines regardless of sign combination. Merchandise revenue is credited to
 * 4100, kept fully separate from Service Revenue (4000). Deterministic — a
 * repair recomputes exactly the lines an interrupted post meant to write.
 */
async function revenueRecognitionLines(
  organizationId: string,
  caseId: string,
  serviceDelta: number,
  merchandiseDelta: number,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<NewJournalEntryLineInput[]> {
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
  return lines;
}

async function postRevenueRecognition(
  organizationId: string,
  caseId: string,
  serviceDelta: number,
  merchandiseDelta: number,
  actorIdentityId: string | null,
  idFactory: () => string,
  now: string,
  dataAdapterMode: DataAdapterMode,
  /** Interrupted order edits (2026-10): the order operation's revenue
      reference (orderRevenueReference), stored as the entry's
      `sourceReferenceId` — how a repair tells whether it was posted. */
  sourceReferenceId: string | null = null,
): Promise<void> {
  if (serviceDelta === 0 && merchandiseDelta === 0) return;
  const lines = await revenueRecognitionLines(organizationId, caseId, serviceDelta, merchandiseDelta, idFactory, dataAdapterMode);

  const { entry } = await createAndPostJournalEntry(
    organizationId,
    {
      entryDate: now,
      sourceType: 'revenue_recognition',
      sourceReferenceId,
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

/**
 * Interrupted order edits (2026-10). What the ledger holds for one order
 * operation's revenue — read from the ledger itself, never assumed: every
 * revenue-recognition entry carrying the operation's reference
 * (`sourceReferenceId`), summed per account over Accounts Receivable,
 * Service Revenue and Merchandise Revenue, and compared with the
 * operation's planned deltas.
 *  - `posted`: exactly the planned effect is in the ledger;
 *  - `not_posted`: no effect at all (no entry, or an entry whose lines
 *    never landed or were netted back to zero by the ledger's own
 *    compensation — generalLedgerService#insertLinesCompensatingOnFailure);
 *  - `partial`: anything else — a ledger entry cut off part way. Never
 *    "fixed" automatically: it needs someone to review the ledger.
 * Throws when the ledger can't be read: the caller must treat that as
 * UNKNOWN, never as "not posted".
 */
export async function getOrderRevenueState(
  params: { organizationId: string; caseId: string; revenueReference: string; serviceDelta: number; merchandiseDelta: number },
  dataAdapterMode: DataAdapterMode,
): Promise<'posted' | 'not_posted' | 'partial'> {
  const { organizationId, caseId, revenueReference, serviceDelta, merchandiseDelta } = params;
  const entries = (await listJournalEntriesForCase(organizationId, caseId, dataAdapterMode)).filter(
    (e) => e.sourceType === 'revenue_recognition' && e.sourceReferenceId === revenueReference && e.organizationId === organizationId,
  );
  if (entries.length === 0) return 'not_posted';
  const [receivable, serviceRevenue, merchandiseRevenue] = await Promise.all([
    getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, dataAdapterMode),
    getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.SERVICE_REVENUE, dataAdapterMode),
    getAccountByNumber(organizationId, STARTER_ACCOUNT_NUMBERS.MERCHANDISE_REVENUE, dataAdapterMode),
  ]);
  // Signed debit-positive nets per account, over every line of every entry.
  const net = new Map<string, number>();
  for (const entry of entries) {
    const withLines = await getJournalEntryWithLines(organizationId, entry.id, dataAdapterMode);
    for (const line of withLines?.lines ?? []) {
      net.set(line.accountId, (net.get(line.accountId) ?? 0) + (line.direction === 'debit' ? line.amount : -line.amount));
    }
  }
  const actual = (accountId: string | undefined) => (accountId ? net.get(accountId) ?? 0 : 0);
  const otherAccounts = [...net.entries()].filter(([id, amount]) => amount !== 0 && id !== receivable?.id && id !== serviceRevenue?.id && id !== merchandiseRevenue?.id);
  const observed = [actual(receivable?.id), actual(serviceRevenue?.id), actual(merchandiseRevenue?.id)];
  if (otherAccounts.length === 0 && observed.every((amount) => amount === 0)) return 'not_posted';
  const expected = [serviceDelta + merchandiseDelta, -serviceDelta, -merchandiseDelta];
  if (otherAccounts.length === 0 && observed.every((amount, i) => amount === expected[i])) return 'posted';
  return 'partial';
}

/**
 * Interrupted order edits (2026-10). The ONE automatic finish of a partial
 * revenue entry: exactly one entry under the operation's reference has
 * lines, and they are a prefix of the lines it was meant to post
 * (revenueRecognitionLines — deterministic). Only the missing lines are
 * added (generalLedgerService#completePartiallyPostedEntryLines). Anything
 * else throws: the ledger then needs review by hand.
 */
export async function completePartialOrderRevenue(
  params: { organizationId: string; caseId: string; serviceDelta: number; merchandiseDelta: number; revenueReference: string; idFactory: () => string },
  dataAdapterMode: DataAdapterMode,
): Promise<number> {
  const entries = (await listJournalEntriesForCase(params.organizationId, params.caseId, dataAdapterMode)).filter(
    (e) => e.sourceType === 'revenue_recognition' && e.sourceReferenceId === params.revenueReference && e.organizationId === params.organizationId,
  );
  const withLines = [];
  for (const entry of entries) {
    const found = await getJournalEntryWithLines(params.organizationId, entry.id, dataAdapterMode);
    if (found && found.lines.length > 0) withLines.push(found);
  }
  if (withLines.length !== 1) throw new Error(`Expected exactly one partially posted entry for ${params.revenueReference}, found ${withLines.length}.`);
  const expected = await revenueRecognitionLines(params.organizationId, params.caseId, params.serviceDelta, params.merchandiseDelta, params.idFactory, dataAdapterMode);
  return completePartiallyPostedEntryLines(params.organizationId, withLines[0].entry.id, expected, dataAdapterMode);
}

/** Posts an order operation's revenue delta under its reference — only
    when the ledger shows none of it (getOrderRevenueState), so a repaired
    or retried operation never posts twice. Refuses (throws) when the ledger
    holds a partial entry. Returns whether the planned effect is now in the
    ledger (false for a zero delta). */
export async function postOrderRevenueOnce(
  params: { organizationId: string; caseId: string; serviceDelta: number; merchandiseDelta: number; performedBy: string | null; revenueReference: string; idFactory: () => string; now?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<boolean> {
  if (params.serviceDelta === 0 && params.merchandiseDelta === 0) return false;
  const state = await getOrderRevenueState(params, dataAdapterMode);
  if (state === 'posted') return true;
  if (state === 'partial') {
    // An entry cut off between its line inserts: finish exactly its missing
    // lines (verified against what it was meant to post) — or refuse.
    await completePartialOrderRevenue(params, dataAdapterMode);
    if ((await getOrderRevenueState(params, dataAdapterMode)) !== 'posted') {
      throw new Error(`The ledger holds a partial revenue entry for ${params.revenueReference}; it must be reviewed by hand before this change can be completed.`);
    }
    return true;
  }
  await postRevenueRecognition(params.organizationId, params.caseId, params.serviceDelta, params.merchandiseDelta, params.performedBy, params.idFactory, params.now ?? new Date().toISOString(), dataAdapterMode, params.revenueReference);
  return true;
}

/** Writes the audit entries whose (pre-assigned) ids aren't stored yet —
    a repair's way to finish an operation's audit trail without
    duplicating any entry. */
export async function persistMissingAuditEntries(organizationId: string, caseId: string, entries: CaseOrderAuditEntry[], dataAdapterMode: DataAdapterMode): Promise<number> {
  if (entries.length === 0) return 0;
  const existing = new Set((await listAuditEntriesForCase(organizationId, caseId, dataAdapterMode)).map((e) => e.id));
  const missing = entries.filter((e) => e.organizationId === organizationId && e.caseId === caseId && !existing.has(e.id));
  await persistAuditEntries(missing, dataAdapterMode);
  return missing.length;
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
 * Phase 37 (Product Variants — ADR-041): the SERVER-authoritative order
 * calculation — service lines + VARIANT-resolved merchandise lines. Replaces
 * the pure `calculateOrderTotalsWithMerchandise` on the server path because that
 * pure function cannot resolve a variant (it needs a variant fetch). Merchandise
 * economics resolve through B2 inheritance (variant override → parent) and are
 * SNAPSHOTTED onto the line (unitPrice, variant sku / name / id in metadata) —
 * history never re-derives from the live catalog. A variant-parent product with
 * no `variantId` is not sellable and is silently skipped (same "org doesn't sell
 * that" contract as a missing product). Deterministic and idempotent.
 */
async function computeOrderWithVariants(
  organizationId: string,
  catalog: ServiceCatalogItem[],
  products: MerchandiseProduct[],
  orderSelections: { services: ServiceSelections; merchandise: MerchandiseSelection[]; customItems: CustomLineItemSelection[] },
  dataAdapterMode: DataAdapterMode,
): Promise<CalculatedOrderTotals> {
  const serviceTotals = calculateOrderTotals(catalog, orderSelections.services);
  const serviceLines = serviceTotals.lineItems;
  const productsById = new Map(products.map((p) => [p.id, p]));

  const merchLines: CalculatedLineItem[] = [];
  for (const sel of orderSelections.merchandise) {
    const product = productsById.get(sel.productId);
    if (!product) continue;
    const variantId = sel.variantId ?? null;
    if (product.hasVariants && !variantId) continue; // parent not independently sellable (R6)
    const variant = variantId ? await getVariantById(organizationId, variantId, dataAdapterMode) : null;
    if (variantId && (!variant || !variant.isActive || variant.productId !== product.id)) continue;
    const eco = resolveVariantEconomics(product, variant);
    const sku = variant?.sku ?? product.sku;
    const description = variant ? `${product.name} — ${variant.name}` : product.name;
    merchLines.push({
      lineKind: 'merchandise',
      serviceCode: sku,
      description,
      quantity: sel.quantity,
      unitPrice: eco.retailPrice,
      lineTotal: eco.retailPrice * sel.quantity,
      sortOrder: 0,
      metadata: { productId: product.id, variantId: variantId ?? '', sku, locationId: sel.locationId },
    });
  }
  // Stable order: category, then description, then sku — identical to the pure
  // merchandise builder, so lines never reshuffle under repricing.
  merchLines.sort((a, b) => {
    const catA = getMerchandiseCategoryDefinition(productsById.get(a.metadata!.productId)!.category)?.sortOrder ?? 999;
    const catB = getMerchandiseCategoryDefinition(productsById.get(b.metadata!.productId)!.category)?.sortOrder ?? 999;
    if (catA !== catB) return catA - catB;
    if (a.description !== b.description) return a.description < b.description ? -1 : 1;
    return a.serviceCode < b.serviceCode ? -1 : a.serviceCode > b.serviceCode ? 1 : 0;
  });
  merchLines.forEach((line, i) => { line.sortOrder = MERCHANDISE_SORT_BASE + i * 10; });

  const customLines = calculateCustomLineItems(orderSelections.customItems);

  const lineItems = [...serviceLines, ...merchLines, ...customLines];
  const subtotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const discountTotal = 0;
  const taxTotal = 0;
  const total = subtotal - discountTotal + taxTotal;
  return { lineItems, subtotal, discountTotal, taxTotal, total, unpricedItems: serviceTotals.unpricedItems };
}

/**
 * Resolves the service half of an order's selections from a raw request
 * body, carrying the current selection forward when the caller doesn't
 * provide one (so a merchandise-only edit never wipes services, and vice
 * versa). Supports both a nested `{ services: {...} }` and the legacy flat
 * `{ weightTier, ... }` shape every pre-Phase-35 caller uses.
 */
function extractServiceSelections(
  raw: unknown,
  currentLineItems: CaseOrderLineItem[] | null,
  catalog: ServiceCatalogItem[],
): ServiceSelections {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (obj.services && typeof obj.services === 'object') {
    const services = obj.services as Record<string, unknown>;
    return withCarriedCatalogItems(withResolvedServiceType(normalizeSelections(services), catalog), services, currentLineItems);
  }
  const hasFlatServiceFields =
    'weightTier' in obj || 'extraDeathCertificateQuantity' in obj || 'mailCremated' in obj || 'serviceTypeCode' in obj || 'catalogItems' in obj;
  if (hasFlatServiceFields) return withCarriedCatalogItems(withResolvedServiceType(normalizeSelections(obj), catalog), obj, currentLineItems);
  if (currentLineItems) return selectionsFromLineItems(currentLineItems);
  return normalizeSelections({});
}

/** Gus Phase 5C-3. A caller that doesn't send `catalogItems` at all (every
    pre-5C-3 caller) leaves the order's catalog items as they are — the same
    carry-forward rule merchandise and custom items follow. An explicit
    empty list removes them. */
function withCarriedCatalogItems(
  selections: ServiceSelections,
  source: Record<string, unknown>,
  currentLineItems: CaseOrderLineItem[] | null,
): ServiceSelections {
  if ('catalogItems' in source || !currentLineItems) return selections;
  const carried = catalogItemSelectionsFromLineItems(currentLineItems);
  return carried.length > 0 ? { ...selections, catalogItems: carried } : selections;
}

/** 2026-10. Server-side validation of a submitted serviceTypeCode against
    THIS organization's own (freshly fetched) catalog — a code that isn't an
    active service_type row is dropped, i.e. treated as "none chosen", so
    it can neither be charged nor recorded in the audit trail. A carried-
    forward selection (selectionsFromLineItems) is history, not input, and
    isn't re-filtered here — the engine itself still only ever charges an
    active service_type row. */
function withResolvedServiceType(selections: ServiceSelections, catalog: ServiceCatalogItem[]): ServiceSelections {
  const resolved = resolveServiceTypeCode(catalog, selections.serviceTypeCode);
  const next: ServiceSelections = { ...selections };
  delete next.serviceTypeCode;
  if (resolved) next.serviceTypeCode = resolved;
  return next;
}

/** The merchandise half — carries current merchandise forward when the
    caller doesn't provide a `merchandise` array. */
function extractMerchandiseSelections(raw: unknown, currentLineItems: CaseOrderLineItem[] | null): MerchandiseSelection[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if ('merchandise' in obj) return normalizeMerchandiseSelections(obj.merchandise);
  if (currentLineItems) return merchandiseSelectionsFromLineItems(currentLineItems);
  return [];
}

/** SOLIS cleanup item #11 (2026-09) — the custom-item half — carries the
    current custom items forward when the caller doesn't provide a
    `customItems` array, exactly mirroring `extractMerchandiseSelections`. */
function extractCustomItemSelections(raw: unknown, currentLineItems: CaseOrderLineItem[] | null): CustomLineItemSelection[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if ('customItems' in obj) return normalizeCustomItemSelections(obj.customItems);
  if (currentLineItems) return customItemSelectionsFromLineItems(currentLineItems);
  return [];
}

type OrderChangeParams = {
  organizationId: string;
  caseId: string;
  selections: unknown;
  performedBy: string;
  idFactory: () => string;
  now?: string;
  /** Gus Phase 5C-3 (finalization). The case's own primary service (from its
      workflow snapshot), which stays choosable on THIS case's order even if
      it has since been deactivated. Supplied by the order routes. */
  caseServiceTypeCode?: string | null;
  /** Gus Phase 5C-3 (finalization). Whether the caller may add, change or
      remove custom (one-off, staff-priced) items — `serviceCatalog.edit`,
      i.e. Administrator or Manager. Absent = not allowed: a change that
      leaves the order's custom items exactly as they are is always fine. */
  canEditCustomItems?: boolean;
};

/** Gus Phase 5C-3 (finalization). A caller without the custom-item
    permission tried to add, change or remove a custom item. Nothing is
    written. */
export class CustomItemPermissionError extends Error {
  constructor() {
    super('You are not allowed to add, change or remove custom items on a case order.');
    this.name = 'CustomItemPermissionError';
  }
}

function sameCustomItems(a: CustomLineItemSelection[], b: CustomLineItemSelection[]): boolean {
  const key = (items: CustomLineItemSelection[]) =>
    JSON.stringify(items.map((item) => [item.description, item.amountCents]).sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1)));
  return key(a) === key(b);
}

/**
 * Consistent service changes (2026-10). Everything an order change decides
 * — the recalculated new version, its line items, its audit entries and
 * the revenue delta it will post — computed with NO write at all, so a
 * caller coordinating it with another write (services/
 * caseServiceChangeService.ts) can validate it up front (unpriced refusal,
 * a catalog read failure) before anything is persisted. `current: null`
 * means the case has no order yet and this creates version 1.
 */
export type PreparedCaseOrderChange =
  | { kind: 'unchanged'; order: CaseOrder; lineItems: CaseOrderLineItem[] }
  | {
      kind: 'change';
      organizationId: string;
      caseId: string;
      performedBy: string;
      nowIso: string;
      current: CaseOrder | null;
      currentLineItems: CaseOrderLineItem[];
      newOrder: CaseOrder;
      newLineItems: CaseOrderLineItem[];
      auditEntries: CaseOrderAuditEntry[];
      /** The per-change diff (empty for a creation — its one audit entry
          says it all). */
      diffEntries: Array<{ action: string; previousValue: string | null; newValue: string | null; description: string; amountDeltaCents: number }>;
      serviceDelta: number;
      merchandiseDelta: number;
    };

type PreparedOrderWrite = Extract<PreparedCaseOrderChange, { kind: 'change' }>;

async function prepareCreation(params: OrderChangeParams, dataAdapterMode: DataAdapterMode): Promise<PreparedOrderWrite> {
  const nowIso = params.now ?? new Date().toISOString();
  // A locked organization (2026-11) reads the full catalog so the case's own,
  // since-deactivated primary service stays choosable; otherwise exactly as before.
  const catalog = catalogForCaseServiceType(
    await getServiceCatalog(params.organizationId, dataAdapterMode, isOrderLinePriceLocked(params.organizationId) ? { includeInactive: true } : {}),
    params.caseServiceTypeCode,
  );
  const products = await getMerchandiseCatalogForPricing(params.organizationId, dataAdapterMode);
  const orderSelections = {
    services: extractServiceSelections(params.selections, null, catalog),
    merchandise: extractMerchandiseSelections(params.selections, null),
    customItems: extractCustomItemSelections(params.selections, null),
  };
  if (orderSelections.customItems.length > 0 && params.canEditCustomItems !== true) throw new CustomItemPermissionError();
  const calculated = await computeOrderWithVariants(params.organizationId, catalog, products, orderSelections, dataAdapterMode);
  assertNoUnpricedItems(calculated);

  // Non-destructive order versioning (2026-10): a case with no ACTIVE
  // order may still have history (every version superseded, e.g. a service
  // change that created the first order and was then reverted). A new order
  // continues that numbering — never a second "version 1" beside the old
  // one — so versions stay unambiguous. A case with no rows at all gets 1.
  const history = await listCaseOrderVersions(params.organizationId, params.caseId, dataAdapterMode);
  const nextVersion = history.reduce((max, o) => Math.max(max, o.version), 0) + 1;

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
    version: nextVersion,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const lineItems = buildLineItems(params.organizationId, orderId, calculated.lineItems, nowIso, params.idFactory);
  const split = sumLineTotalsByKind(calculated.lineItems);
  const serviceCount = calculated.lineItems.filter((li) => li.lineKind === 'service').length;
  const merchandiseCount = calculated.lineItems.filter((li) => li.lineKind === 'merchandise').length;
  const customCount = calculated.lineItems.filter((li) => li.lineKind === 'custom').length;

  const auditEntry: CaseOrderAuditEntry = {
    id: params.idFactory(),
    organizationId: params.organizationId,
    caseId: params.caseId,
    caseOrderId: orderId,
    action: 'order_created',
    previousValue: null,
    newValue: null,
    amountDeltaCents: calculated.total,
    description: `Case order created — ${serviceCount} service${serviceCount === 1 ? '' : 's'}${merchandiseCount > 0 ? `, ${merchandiseCount} merchandise item${merchandiseCount === 1 ? '' : 's'}` : ''}${customCount > 0 ? `, ${customCount} custom item${customCount === 1 ? '' : 's'}` : ''}`,
    performedBy: params.performedBy,
    createdAt: nowIso,
  };

  return {
    kind: 'change',
    organizationId: params.organizationId,
    caseId: params.caseId,
    performedBy: params.performedBy,
    nowIso,
    current: null,
    currentLineItems: [],
    newOrder: order,
    newLineItems: lineItems,
    auditEntries: [auditEntry],
    diffEntries: [],
    serviceDelta: split.service,
    merchandiseDelta: split.merchandise,
  };
}

async function prepareRecalculation(
  current: CaseOrder,
  params: OrderChangeParams,
  dataAdapterMode: DataAdapterMode,
): Promise<PreparedCaseOrderChange> {
  const nowIso = params.now ?? new Date().toISOString();
  const products = await getMerchandiseCatalogForPricing(params.organizationId, dataAdapterMode);
  const currentLineItems = await listLineItemsForOrder(params.organizationId, current.id, dataAdapterMode);
  // Gus Phase 5C-3: lines already on the order keep the price and
  // description they were saved with — see catalogWithOrderSnapshots. The
  // full catalog (inactive rows too) tells it what role each line plays.
  // Order integrity (2026-11): where the organization locks line prices
  // (not Manors yet), lines already on the order keep their agreed price —
  // a newer catalog price reaches them only through repriceCaseOrder.
  // A locked organization also keeps a since-deactivated item on the order
  // until staff remove it; otherwise the catalog is read exactly as before.
  const locked = isOrderLinePriceLocked(params.organizationId);
  const fullCatalog = catalogForCaseServiceType(await getServiceCatalog(params.organizationId, dataAdapterMode, locked ? { includeInactive: true } : {}), params.caseServiceTypeCode);
  const catalog = locked ? catalogWithOrderSnapshots(fullCatalog, currentLineItems) : fullCatalog;

  // Reconstruct ALL THREE dimensions from the current order, then apply
  // only what the caller changed — a service-only edit carries merchandise
  // and custom items forward unchanged, and so on for each other dimension.
  const previousServices = selectionsFromLineItems(currentLineItems);
  const previousMerchandise = merchandiseSelectionsFromLineItems(currentLineItems);
  const previousCustomItems = customItemSelectionsFromLineItems(currentLineItems);
  const nextServices = extractServiceSelections(params.selections, currentLineItems, catalog);
  const nextMerchandise = extractMerchandiseSelections(params.selections, currentLineItems);
  const nextCustomItems = extractCustomItemSelections(params.selections, currentLineItems);
  if (params.canEditCustomItems !== true && !sameCustomItems(previousCustomItems, nextCustomItems)) throw new CustomItemPermissionError();

  const serviceDiff = diffSelections(catalog, previousServices, nextServices);
  const merchandiseDiff = diffMerchandiseSelections(products, previousMerchandise, nextMerchandise);
  const customItemDiff = diffCustomItemSelections(previousCustomItems, nextCustomItems);
  const diffEntries = [...serviceDiff, ...merchandiseDiff, ...customItemDiff];
  if (diffEntries.length === 0) {
    return { kind: 'unchanged', order: current, lineItems: currentLineItems };
  }

  const computed = await computeOrderWithVariants(params.organizationId, catalog, products, { services: nextServices, merchandise: nextMerchandise, customItems: nextCustomItems }, dataAdapterMode);
  // Order integrity (2026-11): merchandise already on the order keeps its
  // agreed price too (services are kept by catalogWithOrderSnapshots above).
  const calculated = locked ? withLockedMerchandisePrices(computed, currentLineItems) : computed;
  assertNoUnpricedItems(calculated);
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

  // Only the NET change per revenue kind — service delta to 4000,
  // merchandise delta to 4100 — so repricing never re-recognizes revenue
  // already booked, and merchandise revenue never leaks into service revenue.
  const newSplit = sumLineTotalsByKind(calculated.lineItems);
  const oldSplit = sumLineTotalsByKind(currentLineItems);

  return {
    kind: 'change',
    organizationId: params.organizationId,
    caseId: params.caseId,
    performedBy: params.performedBy,
    nowIso,
    current,
    currentLineItems,
    newOrder,
    newLineItems,
    auditEntries,
    diffEntries,
    serviceDelta: newSplit.service - oldSplit.service,
    merchandiseDelta: newSplit.merchandise - oldSplit.merchandise,
  };
}

/**
 * Consistent service changes (2026-10). The write-free "prepare" half of a
 * case order change: recalculates the active order from `selections` (or
 * computes version 1 when the case has none yet), throwing
 * UnpricedCatalogItemError — like createCaseOrder/recalculateOrder — when
 * a selected item has no price. Persists nothing.
 */
export async function prepareCaseOrderChange(
  params: OrderChangeParams,
  dataAdapterMode: DataAdapterMode,
): Promise<PreparedCaseOrderChange> {
  // Phase 5A.2: never prepare against a case whose order an unfinished
  // change holds — with no row active, it would otherwise plan a brand-new
  // order (and recognize its whole total as revenue a second time).
  const state = await getCaseOrderState(params.organizationId, params.caseId, dataAdapterMode);
  if (state.interruption) throw new CaseOrderInterruptedError(state.interruption);
  const current = state.active;
  return current ? prepareRecalculation(current, params, dataAdapterMode) : prepareCreation(params, dataAdapterMode);
}

/**
 * Creates a case's first CaseOrder (version 1) from staff-submitted
 * selections — never a submitted total. Always re-fetches the catalog and
 * recalculates server-side (see domain/pricing/calculateOrder.ts). Writes
 * one 'order_created' audit entry so every case's pricing history starts
 * from a real, timestamped record, not an implicit zero state.
 */
export async function createCaseOrder(
  params: OrderChangeParams,
  dataAdapterMode: DataAdapterMode,
): Promise<{ order: CaseOrder; lineItems: CaseOrderLineItem[]; auditEntry: CaseOrderAuditEntry }> {
  await assertCaseOrderNotInterrupted(params.organizationId, params.caseId, dataAdapterMode);
  const prepared = await prepareCreation(params, dataAdapterMode);
  // Non-destructive order versioning (2026-10): the same commit path as
  // every other order write — line items, the order row, its audit entry,
  // then revenue recognition (service → 4000, merchandise → 4100) — so a
  // concurrent creation for the same case is detected (one of them is
  // withdrawn, CaseOrderCommitError `conflict`) and a failure part-way is
  // reverted by appending, never by deleting.
  const committed = await commitPreparedCaseOrderChange(prepared, { idFactory: params.idFactory }, dataAdapterMode);
  return { order: committed.order, lineItems: committed.lineItems, auditEntry: committed.auditEntries[0] };
}

const merchandiseLineKey = (line: { metadata?: Record<string, string> | null }) => `${line.metadata?.productId ?? ''}|${line.metadata?.variantId ?? ''}`;

/** Order integrity (2026-11). A merchandise line already on the order keeps
    the unit price it was agreed at; a newly added one takes today's price. */
function withLockedMerchandisePrices(calculated: CalculatedOrderTotals, currentLineItems: CaseOrderLineItem[]): CalculatedOrderTotals {
  const agreed = new Map(
    currentLineItems.filter((line) => line.lineKind === 'merchandise').map((line) => [merchandiseLineKey(line as { metadata?: Record<string, string> | null }), line.unitPrice]),
  );
  if (agreed.size === 0) return calculated;
  const lineItems = calculated.lineItems.map((line) => {
    if (line.lineKind !== 'merchandise') return line;
    const unitPrice = agreed.get(merchandiseLineKey(line));
    return unitPrice === undefined ? line : { ...line, unitPrice, lineTotal: unitPrice * line.quantity };
  });
  const subtotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);
  return { ...calculated, lineItems, subtotal, total: subtotal - calculated.discountTotal + calculated.taxTotal };
}

/** Price catalog (2026-11). Repricing is not offered to this organization
    (its edits already apply current prices — the legacy model), or the
    caller lacks the permission. Routes answer 403. */
export class RepriceNotAllowedError extends Error {
  constructor() {
    super('Repricing an existing order is not available for this organization.');
    this.name = 'RepriceNotAllowedError';
  }
}

export type RepriceLineChange = { description: string; quantity: number; previousUnitPrice: number; newUnitPrice: number; amountDeltaCents: number };

/**
 * Price catalog (2026-11). The one deliberate way a newer catalog price
 * reaches an existing order: every line priced from the catalog (services,
 * catalog items, merchandise) is priced again at today's price; custom
 * items keep their own amounts; nothing is added or removed. A new order
 * version is written through the same journaled, compare-and-swap path as
 * any edit (the previous version and its audit entries are untouched),
 * with one audit entry per line whose price moved. Pinned to the version
 * staff were shown (`expectedOrderId`); `confirm: false` only previews.
 * A line whose item now has no price set refuses the whole reprice.
 */
export async function repriceCaseOrder(
  params: { organizationId: string; caseId: string; expectedOrderId: string; performedBy: string; idFactory: () => string; confirm: boolean; caseServiceTypeCode?: string | null; now?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ applied: boolean; changes: RepriceLineChange[]; order: CaseOrder; lineItems: CaseOrderLineItem[] } | null> {
  if (!isOrderLinePriceLocked(params.organizationId)) throw new RepriceNotAllowedError();
  const state = await getCaseOrderState(params.organizationId, params.caseId, dataAdapterMode);
  if (state.interruption) throw new CaseOrderInterruptedError(state.interruption);
  const current = state.active;
  if (!current) return null;
  if (current.id !== params.expectedOrderId) throw new CaseOrderConflictError(current);

  const nowIso = params.now ?? new Date().toISOString();
  const currentLineItems = await listLineItemsForOrder(params.organizationId, current.id, dataAdapterMode);
  // Today's catalog, inactive rows included (an item on the order keeps its
  // role), but NO snapshots — that is the point of a reprice.
  const catalog = catalogForCaseServiceType(await getServiceCatalog(params.organizationId, dataAdapterMode, { includeInactive: true }), params.caseServiceTypeCode);
  const products = await getMerchandiseCatalogForPricing(params.organizationId, dataAdapterMode);
  const calculated = await computeOrderWithVariants(
    params.organizationId,
    catalog,
    products,
    { services: selectionsFromLineItems(currentLineItems), merchandise: merchandiseSelectionsFromLineItems(currentLineItems), customItems: customItemSelectionsFromLineItems(currentLineItems) },
    dataAdapterMode,
  );
  assertNoUnpricedItems(calculated);

  const before = new Map(currentLineItems.map((line) => [`${line.lineKind}|${line.serviceCode}`, line]));
  const changes: RepriceLineChange[] = [];
  for (const line of calculated.lineItems) {
    const previous = before.get(`${line.lineKind}|${line.serviceCode}`);
    if (!previous || previous.unitPrice === line.unitPrice) continue;
    changes.push({ description: line.description, quantity: line.quantity, previousUnitPrice: previous.unitPrice, newUnitPrice: line.unitPrice, amountDeltaCents: line.lineTotal - previous.lineTotal });
  }
  if (changes.length === 0 || !params.confirm) return { applied: false, changes, order: current, lineItems: currentLineItems };

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
  const diffEntries = changes.map((change) => ({
    action: 'line_repriced',
    previousValue: String(change.previousUnitPrice),
    newValue: String(change.newUnitPrice),
    description: `Repriced at the current catalog price: ${change.description}, ${formatCentsAsCurrency(change.previousUnitPrice, 'usd')} → ${formatCentsAsCurrency(change.newUnitPrice, 'usd')}${change.quantity > 1 ? ' each' : ''}`,
    amountDeltaCents: change.amountDeltaCents,
  }));
  const newSplit = sumLineTotalsByKind(calculated.lineItems);
  const oldSplit = sumLineTotalsByKind(currentLineItems);
  const prepared: PreparedCaseOrderChange = {
    kind: 'change',
    organizationId: params.organizationId,
    caseId: params.caseId,
    performedBy: params.performedBy,
    nowIso,
    current,
    currentLineItems,
    newOrder,
    newLineItems: buildLineItems(params.organizationId, newOrderId, calculated.lineItems, nowIso, params.idFactory),
    auditEntries: diffEntries.map((entry) => ({
      id: params.idFactory(),
      organizationId: params.organizationId,
      caseId: params.caseId,
      caseOrderId: newOrderId,
      ...entry,
      performedBy: params.performedBy,
      createdAt: nowIso,
    })),
    diffEntries,
    serviceDelta: newSplit.service - oldSplit.service,
    merchandiseDelta: newSplit.merchandise - oldSplit.merchandise,
  };
  try {
    const committed = await commitPreparedCaseOrderChange(prepared, { idFactory: params.idFactory }, dataAdapterMode);
    try {
      await recordCaseOrderChanged(
        { organizationId: params.organizationId, actorIdentityId: params.performedBy, actorMembershipId: null, actorRoleKey: null, correlationId: committed.order.id },
        params.caseId,
        committed.order.id,
        diffEntries,
        dataAdapterMode,
      );
    } catch (error) {
      console.error('Failed to record case.order.changed for a reprice:', error instanceof Error ? error.message : error);
    }
    return { applied: true, changes, order: committed.order, lineItems: committed.lineItems };
  } catch (error) {
    if (error instanceof CaseOrderCommitError && error.conflict) {
      throw new CaseOrderConflictError(await getActiveCaseOrder(params.organizationId, params.caseId, dataAdapterMode));
    }
    throw error;
  }
}

/**
 * Non-destructive order versioning (2026-10). A staff edit was made against
 * an order version that is no longer the active one — someone else changed
 * the case's services first. Nothing was written. `current` is the active
 * order now (null if the case no longer has one), so the caller can show
 * it. Routes answer 409.
 */
export class CaseOrderConflictError extends Error {
  readonly current: CaseOrder | null;
  constructor(current: CaseOrder | null, message = "This case's services were changed by someone else. Reload the services and make your change again.") {
    super(message);
    this.name = 'CaseOrderConflictError';
    this.current = current;
  }
}

/** How many times an unpinned recalculation re-prepares after losing a race. */
export const ORDER_CHANGE_MAX_ATTEMPTS = 3;

/**
 * Edits a case's services: creates a new version reflecting the new
 * selections, supersedes the version it was prepared from, and appends one
 * audit entry per individual change. Returns null if the case has no
 * active CaseOrder to edit (callers should treat this as 404, not a silent
 * create — editing is distinct from initial creation). Returns the
 * unchanged current order (no new version, no audit entries) if the new
 * selections are identical to the current ones — a no-op edit (including
 * a retry of an edit that already landed) never pollutes the version/audit
 * history.
 *
 * Non-destructive order versioning (2026-10, docs/ORDER_VERSIONING.md).
 * The write is commitPreparedCaseOrderChange — the same path a service
 * change uses: the previous version is superseded by a FIELD-SCOPED
 * compare-and-swap (`status`, `supersededAt`, `supersededByOrderId`,
 * `updatedAt` only, and only while it is still active), never by a full
 * replace of the row, so its totals, line items and payment references
 * are untouched. Exactly one request can supersede a given version, so
 * exactly one new version can follow it.
 *
 * `expectedOrderId` — the order version staff were looking at. When it is
 * given and is not (or stops being) the active version, nothing is written
 * and CaseOrderConflictError carries the current order. Every staff-facing
 * route requires it. Without it (server-side callers whose selections are
 * an absolute statement of the whole order), losing a race re-prepares
 * from the new active version, at most ORDER_CHANGE_MAX_ATTEMPTS times.
 */
export async function recalculateOrder(
  params: OrderChangeParams & { expectedOrderId?: string },
  dataAdapterMode: DataAdapterMode,
): Promise<{ order: CaseOrder; lineItems: CaseOrderLineItem[]; auditEntries: CaseOrderAuditEntry[] } | null> {
  for (let attempt = 0; attempt < ORDER_CHANGE_MAX_ATTEMPTS; attempt++) {
    // Phase 5A.2: an unfinished change holds the case's order — refused
    // (CaseOrderInterruptedError) rather than read as "no order yet".
    const state = await getCaseOrderState(params.organizationId, params.caseId, dataAdapterMode);
    if (state.interruption) throw new CaseOrderInterruptedError(state.interruption);
    const current = state.active;
    if (!current) return null;
    if (params.expectedOrderId !== undefined && current.id !== params.expectedOrderId) {
      throw new CaseOrderConflictError(current);
    }

    const prepared = await prepareRecalculation(current, params, dataAdapterMode);
    if (prepared.kind === 'unchanged') {
      return { order: prepared.order, lineItems: prepared.lineItems, auditEntries: [] };
    }

    let committed: CommittedCaseOrderChange;
    try {
      committed = await commitPreparedCaseOrderChange(prepared, { idFactory: params.idFactory }, dataAdapterMode);
    } catch (error) {
      if (error instanceof CaseOrderCommitError && error.conflict) {
        if (params.expectedOrderId !== undefined) {
          throw new CaseOrderConflictError(await getActiveCaseOrder(params.organizationId, params.caseId, dataAdapterMode));
        }
        continue; // Another edit won the race — decide again from the new active version.
      }
      throw error;
    }

    // Phase 24 (Case Activity Timeline & Audit Center): one activity event
    // summarizing this whole recalculation, reusing the exact diff data
    // already computed above — best-effort, never fails the actual order
    // update. `performedBy` carries no resolved membership/role here (this
    // service has no auth context of its own — see this file's own
    // "no new authorization logic" convention), so those two fields are null.
    try {
      await recordCaseOrderChanged(
        { organizationId: params.organizationId, actorIdentityId: params.performedBy, actorMembershipId: null, actorRoleKey: null, correlationId: committed.order.id },
        params.caseId,
        committed.order.id,
        prepared.diffEntries,
        dataAdapterMode,
      );
    } catch (error) {
      console.error('Failed to record case.order.changed activity event:', error instanceof Error ? error.message : error);
    }

    return { order: committed.order, lineItems: committed.lineItems, auditEntries: committed.auditEntries };
  }
  throw new CaseOrderConflictError(
    await getActiveCaseOrder(params.organizationId, params.caseId, dataAdapterMode),
    "This case's services kept changing while the update was being saved. Reload the services and try again.",
  );
}

// ---------------------------------------------------------------------------
// Consistent service changes (2026-10) — the order half of a coordinated
// service change (services/caseServiceChangeService.ts): commit a prepared
// change behind a compare-and-swap, and undo it (by appending, never by
// deleting) when the case half can't be written.
// ---------------------------------------------------------------------------

/** Thrown by commitPreparedCaseOrderChange. `conflict`: another edit
    changed the order between prepare and commit (the active version was no
    longer the one prepared from). `compensated: false`: a partial write
    could NOT be undone — the case needs repair. */
export class CaseOrderCommitError extends Error {
  readonly conflict: boolean;
  readonly compensated: boolean;
  readonly compensationError: string | null;
  constructor(message: string, options: { conflict: boolean; compensated: boolean; compensationError?: string | null }) {
    super(message);
    this.name = 'CaseOrderCommitError';
    this.conflict = options.conflict;
    this.compensated = options.compensated;
    this.compensationError = options.compensationError ?? null;
  }
}

export type CommittedCaseOrderChange = {
  prepared: PreparedOrderWrite;
  order: CaseOrder;
  lineItems: CaseOrderLineItem[];
  auditEntries: CaseOrderAuditEntry[];
  /** Whether a revenue-recognition journal entry was posted — the one
      thing a compensation must reverse with an opposite entry. */
  revenuePosted: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compare-and-swap of one CaseOrder row's status. Mock: an in-memory check.
 * Wix: a conditional patch on `status` (+ its supersede metadata and
 * `updatedAt`), so a row another request already moved is never flipped
 * again. `expectSupersededBy` adds "and it was superseded by THIS
 * version" to the condition — a reactivation can then never revive a
 * version some other change replaced. 'conflict' = the row was not in
 * `from` (HTTP 428 / not found); 'failed' = any other failure.
 */
async function swapCaseOrderStatus(
  organizationId: string,
  caseOrderId: string,
  from: CaseOrder['status'],
  to: CaseOrder['status'],
  dataAdapterMode: DataAdapterMode,
  /** The version replacing this one (→ superseded). Recorded with the
      flip; a flip from superseded back to active clears both supersede
      fields. */
  supersededByOrderId?: string,
  options: { expectSupersededBy?: string } = {},
): Promise<'applied' | 'conflict' | 'failed'> {
  const nowIso = new Date().toISOString();
  const fields: Record<string, unknown> = { status: to, updatedAt: nowIso };
  if (to === 'superseded') {
    fields.supersededAt = nowIso;
    if (supersededByOrderId) fields.supersededByOrderId = supersededByOrderId;
  } else if (from === 'superseded') {
    fields.supersededAt = null;
    fields.supersededByOrderId = null;
  }
  if (dataAdapterMode === 'mock') {
    const index = caseOrderFixtures.findIndex((o) => o.organizationId === organizationId && o.id === caseOrderId);
    if (index === -1 || caseOrderFixtures[index].status !== from) return 'conflict';
    if (options.expectSupersededBy !== undefined && caseOrderFixtures[index].supersededByOrderId !== options.expectSupersededBy) return 'conflict';
    caseOrderFixtures[index] = { ...caseOrderFixtures[index], ...(fields as Partial<CaseOrder>) };
    return 'applied';
  }
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, beaconCaseOrderId: caseOrderId },
    paging: { limit: 1 },
  });
  const item = response.dataItems[0];
  if (!item) return 'conflict';
  // Field-scoped (PatchDataItem): only the status and its supersede
  // metadata — the row's totals and every other field are never re-sent.
  const filter: Record<string, unknown> = { organizationId: { $eq: organizationId }, beaconCaseOrderId: { $eq: caseOrderId }, status: { $eq: from } };
  if (options.expectSupersededBy !== undefined) filter.supersededByOrderId = { $eq: options.expectSupersededBy };
  const result = await conditionalPatchWixDataItemFields('caseOrders', item.id, fields, { filter });
  if (result.applied) return 'applied';
  return result.status === 428 || result.status === 412 ? 'conflict' : 'failed';
}

/** One row as it is stored now (any status), or null. */
async function loadCaseOrderRow(organizationId: string, caseOrderId: string, dataAdapterMode: DataAdapterMode): Promise<CaseOrder | null> {
  if (dataAdapterMode === 'mock') return caseOrderFixtures.find((o) => o.organizationId === organizationId && o.id === caseOrderId) ?? null;
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, beaconCaseOrderId: caseOrderId },
    paging: { limit: 1 },
  });
  const order = mapWixCaseOrderItem(response.dataItems[0]?.data);
  return order && order.organizationId === organizationId ? order : null;
}

/** A swap whose response may have been lost: when it reports a failure,
    the row as it is now decides whether it actually landed. */
async function swapCaseOrderStatusChecked(
  organizationId: string,
  caseOrderId: string,
  from: CaseOrder['status'],
  to: CaseOrder['status'],
  dataAdapterMode: DataAdapterMode,
  supersededByOrderId?: string,
  options: { expectSupersededBy?: string } = {},
): Promise<'applied' | 'conflict' | 'failed'> {
  const swapped = await swapCaseOrderStatus(organizationId, caseOrderId, from, to, dataAdapterMode, supersededByOrderId, options).catch(() => 'failed' as const);
  if (swapped !== 'failed') return swapped;
  const now = await loadCaseOrderRow(organizationId, caseOrderId, dataAdapterMode).catch(() => null);
  if (now && now.status === to && (to !== 'superseded' || !supersededByOrderId || now.supersededByOrderId === supersededByOrderId)) return 'applied';
  return 'failed';
}

/**
 * Interrupted order edits (2026-10). The order rows an administrator's
 * repair may move, exported for services/orderOperationRepair.ts — every
 * one a compare-and-swap (a repair racing another repair, or a live
 * request, moves a row at most once) whose lost response is re-checked.
 */
export function swapCaseOrderStatusForRepair(
  organizationId: string,
  caseOrderId: string,
  from: CaseOrder['status'],
  to: CaseOrder['status'],
  dataAdapterMode: DataAdapterMode,
  supersededByOrderId?: string,
  options: { expectSupersededBy?: string } = {},
): Promise<'applied' | 'conflict' | 'failed'> {
  return swapCaseOrderStatusChecked(organizationId, caseOrderId, from, to, dataAdapterMode, supersededByOrderId, options);
}

/** How long a repair claim holds before another repair may take over
    (a repair that died part way must not block the operation forever). */
export const ORDER_REPAIR_CLAIM_TTL_MS = 2 * 60 * 1000;

/**
 * Interrupted order edits (2026-10). Claims one order row for ONE repair
 * at a time — a conditional patch of `repairClaimedAt` (epoch ms) that
 * applies only when the row is unclaimed or its claim has expired. Two
 * administrators repairing the same operation at once: exactly one gets
 * the claim; the other is refused, so revenue can never be posted twice.
 */
export async function claimCaseOrderForRepair(organizationId: string, caseOrderId: string, dataAdapterMode: DataAdapterMode, now: number = Date.now()): Promise<boolean> {
  const staleBefore = now - ORDER_REPAIR_CLAIM_TTL_MS;
  if (dataAdapterMode === 'mock') {
    const index = caseOrderFixtures.findIndex((o) => o.organizationId === organizationId && o.id === caseOrderId);
    if (index === -1) return false;
    const claimed = (caseOrderFixtures[index] as CaseOrder & { repairClaimedAt?: number }).repairClaimedAt;
    if (typeof claimed === 'number' && claimed >= staleBefore) return false;
    caseOrderFixtures[index] = { ...caseOrderFixtures[index], repairClaimedAt: now } as CaseOrder;
    return true;
  }
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', { filter: { organizationId, beaconCaseOrderId: caseOrderId }, paging: { limit: 1 } });
  const item = response.dataItems[0];
  if (!item) return false;
  const result = await conditionalPatchWixDataItemFields('caseOrders', item.id, { repairClaimedAt: now }, {
    filter: {
      $and: [
        { organizationId: { $eq: organizationId } },
        { beaconCaseOrderId: { $eq: caseOrderId } },
        { $or: [{ repairClaimedAt: { $eq: null } }, { repairClaimedAt: { $lt: staleBefore } }] },
      ],
    },
  });
  return result.applied;
}

/** Every row of one case currently marked active (normally exactly one). */
async function listActiveOrderRowsForCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<CaseOrder[]> {
  if (dataAdapterMode === 'mock') {
    return caseOrderFixtures.filter((o) => o.organizationId === organizationId && o.caseId === caseId && o.status === 'active');
  }
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, caseId, status: 'active' },
    paging: { limit: ACTIVE_ORDER_LOOKUP_LIMIT },
  });
  return response.dataItems
    .map((item) => mapWixCaseOrderItem(item.data))
    .filter((o): o is CaseOrder => o !== null && o.organizationId === organizationId && o.caseId === caseId);
}

function orderOperationContext(organizationId: string, performedBy: string | null, correlationId: string): ActivityContext {
  return { organizationId, actorIdentityId: performedBy, actorMembershipId: null, actorRoleKey: null, correlationId };
}

/**
 * Interrupted order edits (2026-10). Takes back an unfinished change whose
 * new version never took effect: the previous version back to active
 * (only if THIS change superseded it and nothing else is active), the
 * pending version to `withdrawn`. Never touches revenue — none is posted
 * before activation. Returns whether both are now in place.
 */
async function withdrawPendingChange(
  organizationId: string,
  caseId: string,
  pendingOrderId: string,
  previousOrderId: string | null,
  dataAdapterMode: DataAdapterMode,
): Promise<boolean> {
  let ok = true;
  if (previousOrderId) {
    const previous = await loadCaseOrderRow(organizationId, previousOrderId, dataAdapterMode).catch(() => null);
    if (previous?.status === 'superseded' && previous.supersededByOrderId === pendingOrderId) {
      const others = (await listActiveOrderRowsForCase(organizationId, caseId, dataAdapterMode).catch(() => null)) ?? null;
      if (others === null) ok = false;
      else if (others.length === 0) {
        const back = await swapCaseOrderStatusChecked(organizationId, previousOrderId, 'superseded', 'active', dataAdapterMode, undefined, { expectSupersededBy: pendingOrderId });
        if (back !== 'applied') ok = false;
      }
    } else if (!previous) {
      ok = false;
    }
  }
  const pending = await loadCaseOrderRow(organizationId, pendingOrderId, dataAdapterMode).catch(() => undefined);
  if (pending === undefined) return false;
  if (pending?.status === 'pending') {
    const withdrawn = await swapCaseOrderStatusChecked(organizationId, pendingOrderId, 'pending', 'withdrawn', dataAdapterMode);
    if (withdrawn !== 'applied') ok = false;
  }
  return ok;
}

/** Interrupted order edits (2026-10): an administrator's roll-back of an
    unfinished change that never took effect (see withdrawPendingChange). */
export function withdrawPendingOrderChange(
  organizationId: string,
  caseId: string,
  pendingOrderId: string,
  previousOrderId: string | null,
  dataAdapterMode: DataAdapterMode,
): Promise<boolean> {
  return withdrawPendingChange(organizationId, caseId, pendingOrderId, previousOrderId, dataAdapterMode);
}

/**
 * Commits a prepared order change. Interrupted order edits (2026-10, Phase
 * 5A.2 — docs/ORDER_VERSIONING.md): the write order keeps every moment
 * between two writes either invisible, locked, or undoable, and the whole
 * operation is journaled (services/orderOperationJournal.ts) so one
 * interrupted by a crash can be found and repaired:
 *
 *  0. refused if an unfinished change already holds the case's order;
 *  1. journal `prepared` — BEFORE any write; if it can't be recorded the
 *     change is refused (CaseOrderJournalUnavailableError) and nothing is
 *     written;
 *  2. the new version's line items (invisible until their order row is);
 *  3. the new version, as `pending` (never billed or listed; it LOCKS the
 *     case's order until it is activated or withdrawn);
 *  4. compare-and-swap the prepared-from version active → superseded — if
 *     it is no longer active, another edit won the race: the pending
 *     version is withdrawn, 409;
 *  5. compare-and-swap the new version pending → active — the case never
 *     has two active versions (the first-order race below is detected and
 *     withdrawn) and, between 4 and 5, its billing is still resolved to
 *     the superseded version (resolveCaseOrderState), never to $0;
 *     journal `activated`;
 *  6. its audit entries (ids fixed in the plan);
 *  7. the revenue-recognition delta, under the operation's reference;
 *     journal `completed`.
 * A failure before 5 takes the change back (previous version reactivated,
 * pending one withdrawn — nothing to reverse); at 6–7 the change is
 * reverted by a restoring version, reversing revenue only when the ledger
 * shows it was posted. A crash anywhere leaves the journal pointing at it.
 * Wix commits none of these writes together; nothing here claims it does.
 */
export async function commitPreparedCaseOrderChange(
  prepared: PreparedOrderWrite,
  options: {
    idFactory: () => string;
    journalContext?: ActivityContext;
    /** false for a compensation's own restoring version: if IT fails after
        activation it is left for repair, never reverted by yet another
        version (no unbounded chain of compensations). */
    revertOnFailure?: boolean;
    /** How the journal labels the operation (default: create/edit). */
    kind?: OrderOperationKind;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<CommittedCaseOrderChange> {
  const { organizationId, caseId, current, newOrder, newLineItems, auditEntries } = prepared;
  const kind: OrderOperationKind = options.kind ?? (current ? 'edit' : 'create');
  const operationId = newOrder.id;
  const revenueReference = orderRevenueReference(kind, newOrder.id);
  const ctx = options.journalContext ?? orderOperationContext(organizationId, prepared.performedBy, operationId);
  const journal = (status: OrderOperationStatus, details: OrderOperationDetails = {}) =>
    recordOrderOperationJournalBestEffort(ctx, { operationId, caseId, status, details }, dataAdapterMode);

  // 0. The case's order must not be held by an unfinished change.
  await assertCaseOrderNotInterrupted(organizationId, caseId, dataAdapterMode);

  // 1. Journal — before any write, or no write at all.
  try {
    await recordOrderOperationJournal(
      ctx,
      {
        operationId,
        caseId,
        status: 'prepared',
        details: {
          kind,
          previousOrderId: current?.id ?? null,
          previousVersion: current?.version ?? null,
          plannedOrderId: newOrder.id,
          plannedVersion: newOrder.version,
          plannedTotal: newOrder.total,
          serviceDelta: prepared.serviceDelta,
          merchandiseDelta: prepared.merchandiseDelta,
          revenueReference,
          auditEntries,
        },
      },
      dataAdapterMode,
    );
  } catch (error) {
    throw new CaseOrderJournalUnavailableError(error);
  }

  // 2. Line items.
  try {
    await persistLineItems(newLineItems, dataAdapterMode);
  } catch (error) {
    await journal('abandoned', { reason: `the new order lines could not be saved: ${errorMessage(error)}` });
    throw new CaseOrderCommitError(`Could not save the new case order lines: ${errorMessage(error)}`, { conflict: false, compensated: true });
  }

  // 3. The new version, pending.
  const pendingRow: CaseOrder = { ...newOrder, status: 'pending', ...(current ? { supersedesOrderId: current.id } : {}) };
  try {
    await persistCaseOrder(pendingRow, dataAdapterMode);
  } catch (error) {
    // A lost response is not a failed insert — re-check before giving up.
    if (!(await caseOrderExists(organizationId, newOrder.id, dataAdapterMode).catch(() => false))) {
      await journal('abandoned', { reason: `the new order version could not be saved: ${errorMessage(error)}` });
      throw new CaseOrderCommitError(`Could not save the new case order: ${errorMessage(error)}`, { conflict: false, compensated: true });
    }
  }

  /** Takes the change back before activation; records the outcome. */
  const takeBack = async (reason: string, conflict: boolean, message: string): Promise<never> => {
    const compensated = await withdrawPendingChange(organizationId, caseId, newOrder.id, current?.id ?? null, dataAdapterMode).catch(() => false);
    await journal(compensated ? 'abandoned' : 'failed', { reason });
    throw new CaseOrderCommitError(message, {
      conflict,
      compensated,
      compensationError: compensated ? null : `Case order ${newOrder.id} could not be withdrawn; it needs repair.`,
    });
  };

  // 4. Supersede the version this change was prepared from.
  if (current) {
    const swapped = await swapCaseOrderStatusChecked(organizationId, current.id, 'active', 'superseded', dataAdapterMode, newOrder.id);
    if (swapped !== 'applied') {
      await takeBack(
        swapped === 'conflict' ? 'the order changed since this change was prepared' : 'the previous version could not be superseded',
        swapped === 'conflict',
        swapped === 'conflict'
          ? "This case's services were changed by someone else since the preview was shown. Reload the case and try again."
          : 'Could not update the case order.',
      );
    }
  }

  // 5. Activate the new version.
  const activated = await swapCaseOrderStatusChecked(organizationId, newOrder.id, 'pending', 'active', dataAdapterMode);
  if (activated !== 'applied') {
    await takeBack('the new version could not be activated', false, 'Could not save the new case order.');
  }

  if (!current) {
    // A first order has no previous version to compare-and-swap, so two
    // creations racing for the same case could both activate. Each checks
    // after activating: if any OTHER active row exists, this one withdraws
    // itself (before any audit entry or revenue is written) and reports a
    // conflict. Two that check at the same moment both withdraw — staff
    // retry — which is safe; two active orders never stand.
    const others = await listActiveOrderRowsForCase(organizationId, caseId, dataAdapterMode).catch(() => null);
    const rival = others?.find((o) => o.id !== newOrder.id) ?? null;
    if (rival) {
      const withdrawn = await swapCaseOrderStatusChecked(organizationId, newOrder.id, 'active', 'withdrawn', dataAdapterMode);
      await journal(withdrawn === 'applied' ? 'abandoned' : 'failed', { reason: 'another first order was created for this case at the same time' });
      throw new CaseOrderCommitError("This case's services were set up by someone else at the same time. Reload the case and try again.", {
        conflict: true,
        compensated: withdrawn === 'applied',
        compensationError: withdrawn === 'applied' ? null : `Could not withdraw case order ${newOrder.id} (${withdrawn}).`,
      });
    }
  }
  await journal('activated');

  const persistedOrder: CaseOrder = { ...newOrder, status: 'active' };
  const committed: CommittedCaseOrderChange = { prepared, order: persistedOrder, lineItems: newLineItems, auditEntries, revenuePosted: false };
  // 6–7. Audit trail and revenue.
  try {
    await persistAuditEntries(auditEntries, dataAdapterMode);
    // A fresh operation id: its revenue cannot be in the ledger yet (a
    // repair, which can't know that, uses postOrderRevenueOnce instead).
    await postRevenueRecognition(organizationId, caseId, prepared.serviceDelta, prepared.merchandiseDelta, prepared.performedBy, options.idFactory, prepared.nowIso, dataAdapterMode, revenueReference);
    committed.revenuePosted = prepared.serviceDelta !== 0 || prepared.merchandiseDelta !== 0;
  } catch (error) {
    // Revert only when the ledger says for certain whether revenue was
    // posted — reversing revenue that was never posted (or leaving posted
    // revenue in place) would corrupt the ledger. Unknown → needs repair.
    const revenueState = await getOrderRevenueState(
      { organizationId, caseId, revenueReference, serviceDelta: prepared.serviceDelta, merchandiseDelta: prepared.merchandiseDelta },
      dataAdapterMode,
    ).catch(() => null);
    const posted = revenueState === 'posted' ? true : revenueState === 'not_posted' ? false : null;
    let compensationError: string | null = null;
    if (posted === null) {
      compensationError = revenueState === 'partial' ? 'the ledger holds a partial revenue entry for this change' : 'whether revenue was posted could not be read from the ledger';
    } else if (options.revertOnFailure === false) {
      committed.revenuePosted = posted;
      compensationError = 'the restoring version could not be completed; it is left for an administrator to repair';
    } else {
      committed.revenuePosted = posted;
      try {
        await revertCommittedCaseOrderChange(committed, { idFactory: options.idFactory, reason: 'the order could not be completed', journalContext: ctx }, dataAdapterMode);
      } catch (compensation) {
        compensationError = errorMessage(compensation);
      }
    }
    await journal(compensationError === null ? 'compensated' : 'failed', { reason: errorMessage(error), revenuePosted: committed.revenuePosted });
    throw new CaseOrderCommitError(`Could not complete the case order change: ${errorMessage(error)}`, {
      conflict: false,
      compensated: compensationError === null,
      compensationError,
    });
  }
  await journal('completed', { revenuePosted: committed.revenuePosted });
  return committed;
}

/**
 * The compensation for a committed order change whose service change
 * could not be completed. Never deletes or rewrites anything: the
 * committed version, its line items and audit entries stay as history.
 * Instead it APPENDS —
 *  - a restoring version (committed version + 1) whose line items are
 *    exact copies of the version the change was prepared from (same
 *    descriptions, prices and totals — never re-priced from today's
 *    catalog), written pending and activated by the same journaled
 *    sequence as any order change (commitPreparedCaseOrderChange); or,
 *    when the change created the case's first order, the committed
 *    version superseded with nothing replacing it (the case is back to
 *    having no active order) — journaled as a `withdraw` operation;
 *  - one 'service_change_reverted' audit entry explaining why;
 *  - an opposite revenue-recognition entry, when one was posted (under its
 *    own reference, so it is never posted twice).
 * Throws when any step fails — the caller must then record an explicit
 * needs-repair marker; the journal already points at the operation.
 */
export async function revertCommittedCaseOrderChange(
  committed: CommittedCaseOrderChange,
  options: { idFactory: () => string; reason: string; journalContext?: ActivityContext },
  dataAdapterMode: DataAdapterMode,
): Promise<CaseOrder | null> {
  const { prepared } = committed;
  const { organizationId, caseId, current, performedBy } = prepared;
  const nowIso = new Date().toISOString();
  const serviceDelta = committed.revenuePosted ? -prepared.serviceDelta : 0;
  const merchandiseDelta = committed.revenuePosted ? -prepared.merchandiseDelta : 0;

  const auditEntry = (caseOrderId: string): CaseOrderAuditEntry => ({
    id: options.idFactory(),
    organizationId,
    caseId,
    caseOrderId,
    action: 'service_change_reverted',
    previousValue: `version ${committed.order.version}`,
    newValue: current ? `version ${current.version}` : null,
    amountDeltaCents: (current?.total ?? 0) - committed.order.total,
    description: current
      ? `Service change not applied (${options.reason}) — restored the services of version ${current.version}`
      : `Service change not applied (${options.reason}) — the case order it created was withdrawn`,
    performedBy,
    createdAt: nowIso,
  });

  if (current) {
    const paidAmount = await getPaidAmountForCase(organizationId, caseId, dataAdapterMode);
    const restoredId = options.idFactory();
    const restored: CaseOrder = {
      id: restoredId,
      organizationId,
      caseId,
      status: 'active',
      subtotal: current.subtotal,
      discountTotal: current.discountTotal,
      taxTotal: current.taxTotal,
      total: current.total,
      balanceDue: calculateBalance(current.total, paidAmount),
      version: committed.order.version + 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const restoredLineItems = prepared.currentLineItems.map((line) => ({ ...line, id: options.idFactory(), caseOrderId: restoredId, createdAt: nowIso }));
    const restoring: PreparedOrderWrite = {
      kind: 'change',
      organizationId,
      caseId,
      performedBy,
      nowIso,
      current: committed.order,
      currentLineItems: committed.lineItems,
      newOrder: restored,
      newLineItems: restoredLineItems,
      auditEntries: [auditEntry(restoredId)],
      diffEntries: [],
      serviceDelta,
      merchandiseDelta,
    };
    const done = await commitPreparedCaseOrderChange(
      restoring,
      { idFactory: options.idFactory, journalContext: options.journalContext ? { ...options.journalContext, correlationId: restoredId } : undefined, revertOnFailure: false, kind: 'restore' },
      dataAdapterMode,
    );
    return done.order;
  }

  // The change created the case's first order: withdraw it.
  const operationId = `withdraw-${committed.order.id}`;
  const revenueReference = orderRevenueReference('withdraw', committed.order.id);
  const ctx = options.journalContext ? { ...options.journalContext, correlationId: operationId } : orderOperationContext(organizationId, performedBy, operationId);
  const audit = auditEntry(committed.order.id);
  try {
    await recordOrderOperationJournal(
      ctx,
      {
        operationId,
        caseId,
        status: 'prepared',
        details: { kind: 'withdraw', previousOrderId: committed.order.id, previousVersion: committed.order.version, plannedOrderId: null, plannedVersion: null, plannedTotal: null, serviceDelta, merchandiseDelta, revenueReference, auditEntries: [audit] },
      },
      dataAdapterMode,
    );
  } catch (error) {
    throw new CaseOrderJournalUnavailableError(error);
  }
  const swapped = await swapCaseOrderStatusChecked(organizationId, committed.order.id, 'active', 'superseded', dataAdapterMode);
  if (swapped !== 'applied') {
    await recordOrderOperationJournalBestEffort(ctx, { operationId, caseId, status: swapped === 'conflict' ? 'abandoned' : 'failed', details: { reason: `could not supersede case order ${committed.order.id} (${swapped})` } }, dataAdapterMode);
    throw new Error(`Could not supersede case order ${committed.order.id} (${swapped}).`);
  }
  await recordOrderOperationJournalBestEffort(ctx, { operationId, caseId, status: 'activated' }, dataAdapterMode);
  await persistAuditEntries([audit], dataAdapterMode);
  await postRevenueRecognition(organizationId, caseId, serviceDelta, merchandiseDelta, performedBy, options.idFactory, nowIso, dataAdapterMode, revenueReference);
  const revenuePosted = serviceDelta !== 0 || merchandiseDelta !== 0;
  await recordOrderOperationJournalBestEffort(ctx, { operationId, caseId, status: 'completed', details: { revenuePosted } }, dataAdapterMode);
  return null;
}

async function caseOrderExists(organizationId: string, caseOrderId: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  if (dataAdapterMode === 'mock') return caseOrderFixtures.some((o) => o.organizationId === organizationId && o.id === caseOrderId);
  const response = await queryWixDataItems<WixCaseOrderItem>('caseOrders', {
    filter: { organizationId, beaconCaseOrderId: caseOrderId },
    paging: { limit: 1 },
  });
  return mapWixCaseOrderItem(response.dataItems[0]?.data) !== null;
}

/** How many times a balance refresh recomputes after losing a race. */
const BALANCE_REFRESH_MAX_ATTEMPTS = 3;

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
  // Case concurrency (2026-10): in Wix mode the write is FIELD-SCOPED
  // (`balanceDue` + `updatedAt` only — never the whole order row from an
  // earlier read) and a compare-and-swap on the balance it was computed
  // from, on a row that must still be this organization's ACTIVE order. Two
  // payments settling at once (a webhook and a status poll) each recompute
  // from the payments as they are, so the last write always reflects every
  // payment; one that lost the race simply recomputes. Bounded attempts.
  for (let attempt = 0; attempt < BALANCE_REFRESH_MAX_ATTEMPTS; attempt++) {
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
    const patched = await conditionalPatchWixDataItemFields<WixCaseOrderItem>(
      'caseOrders',
      existingItem.id,
      { balanceDue, updatedAt: nowIso },
      {
        filter: {
          organizationId: { $eq: organizationId },
          beaconCaseOrderId: { $eq: order.id },
          status: { $eq: 'active' },
          balanceDue: { $eq: typeof existingItem.data.balanceDue === 'number' ? existingItem.data.balanceDue : null },
        },
      },
    );
    if (patched.applied) {
      return mapWixCaseOrderItem(patched.dataItem?.data ?? { ...existingItem.data, balanceDue, updatedAt: nowIso });
    }
    if (patched.status !== 428 && patched.status !== 412) {
      throw new Error(`Could not refresh the balance of case order ${order.id} (HTTP ${patched.status}).`);
    }
    // Another writer moved the order first — recompute from scratch.
  }
  throw new Error(`Could not refresh the balance of case ${caseId}: the order kept changing concurrently.`);
}

// ---------------------------------------------------------------------------
// 2026-10 (Gus Camacho Jr. service catalog). In-app catalog price editing —
// Settings › Price Catalog (PATCH /api/service-catalog/[itemId]).
// ---------------------------------------------------------------------------

/** Sanity ceiling on one catalog price ($1,000,000.00) — bounds a malformed
    or tampered submission, not a business rule. */
export const MAX_SERVICE_CATALOG_PRICE_CENTS = 100_000_000;

/** A valid new price: a non-negative integer number of cents within the
    sanity ceiling, or null to clear it back to "price not set". */
export function isValidServiceCatalogPrice(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_SERVICE_CATALOG_PRICE_CENTS;
}

/**
 * Sets (or, with null, clears) one catalog row's `defaultPrice`. Strictly
 * organization-scoped: returns null — never touches anything — when no row
 * with `itemId` belongs to `organizationId` (missing, or another
 * organization's row; the route answers 404 either way, so a caller can't
 * probe for other tenants' ids). Only `defaultPrice`/`updatedAt` ever
 * change. Existing CaseOrders are unaffected — each line snapshotted its
 * unitPrice when it was calculated; the new price applies from the next
 * calculation on. Records one activity event, best-effort (a failed audit
 * write never fails the edit itself, same as recalculateOrder's).
 */
export { CatalogPriceConflictError } from './catalogPriceChangeJournal';

export async function updateServiceCatalogItemPrice(
  params: { organizationId: string; itemId: string; defaultPrice: number | null; ctx: ActivityContext; now?: string; reason?: string | null; requestKey?: string | null },
  dataAdapterMode: DataAdapterMode,
): Promise<{ item: ServiceCatalogItem; previousPrice: number | null } | null> {
  if (!isValidServiceCatalogPrice(params.defaultPrice)) {
    throw new Error('defaultPrice must be a non-negative integer number of cents, or null.');
  }
  const nowIso = params.now ?? new Date().toISOString();
  let updated: ServiceCatalogItem;
  let previousPrice: number | null;

  const beginChange = (existing: ServiceCatalogItem) =>
    // Price history first (2026-11): recorded `pending` before the price is
    // touched; if it can't be recorded, nothing changes. See
    // services/catalogPriceChangeJournal.ts for the full protocol.
    beginCatalogPriceChange(
      params.ctx,
      { itemType: 'service', itemId: existing.id, itemCode: existing.serviceCode, itemName: existing.displayName, previousPrice: existing.defaultPrice, newPrice: params.defaultPrice, reason: params.reason, requestKey: params.requestKey, now: nowIso },
      dataAdapterMode,
    );

  if (dataAdapterMode === 'mock') {
    const index = serviceCatalogFixtures.findIndex((item) => item.id === params.itemId && item.organizationId === params.organizationId);
    if (index === -1) return null;
    const existing = serviceCatalogFixtures[index];
    previousPrice = existing.defaultPrice;
    const change = await beginChange(existing);
    updated = { ...existing, defaultPrice: params.defaultPrice, updatedAt: nowIso, ...(change ? { priceChangeId: change.id } : {}) };
    serviceCatalogFixtures[index] = updated;
    if (change) await settleCatalogPriceChange(change, 'applied', dataAdapterMode);
  } else {
    const readRow = async () => {
      const response = await queryWixDataItems<WixServiceCatalogItem>('serviceCatalog', {
        filter: { organizationId: params.organizationId, beaconServiceCatalogId: params.itemId },
        paging: { limit: 1 },
      });
      const item = response.dataItems[0];
      const mapped = mapWixServiceCatalogItem(item?.data);
      // Belt and braces: the query is already org-filtered, but the mapped
      // row's own organizationId is re-checked before any write.
      if (!item || !mapped || mapped.organizationId !== params.organizationId || mapped.id !== params.itemId) return null;
      return { item, mapped };
    };
    const read = await readRow();
    if (!read) return null;
    const { item: existingItem, mapped: existing } = read;
    previousPrice = existing.defaultPrice;
    const previousMarker = typeof (existingItem.data as { priceChangeId?: unknown }).priceChangeId === 'string' ? (existingItem.data as { priceChangeId: string }).priceChangeId : null;
    const change = await beginChange(existing);

    // One field-scoped patch (price, updatedAt and the history marker — never
    // a full replace), applied only while the price (and marker) are still
    // the ones just read: two administrators can't silently overwrite each
    // other, and the marker moves in the same single-item write as the price.
    const fields: Record<string, unknown> = { defaultPrice: params.defaultPrice, updatedAt: nowIso, ...(change ? { priceChangeId: change.id } : {}) };
    const filter: Record<string, unknown> = {
      organizationId: { $eq: params.organizationId },
      beaconServiceCatalogId: { $eq: params.itemId },
      defaultPrice: { $eq: previousPrice },
      ...(change ? { priceChangeId: { $eq: previousMarker } } : {}),
    };
    let written: Awaited<ReturnType<typeof conditionalPatchWixDataItemFields<WixServiceCatalogItem>>> | null = null;
    let failure: unknown = null;
    try {
      written = await conditionalPatchWixDataItemFields<WixServiceCatalogItem>('serviceCatalog', existingItem.id, fields, { filter });
    } catch (error) {
      failure = error;
    }

    if (written?.applied) {
      if (change) await settleCatalogPriceChange(change, 'applied', dataAdapterMode);
      const mapped = mapWixServiceCatalogItem({ ...existingItem.data, ...written.dataItem?.data, ...fields });
      if (!mapped) throw new Error('Failed to update service catalog item.');
      updated = mapped;
    } else if (written && written.status === 428) {
      // Someone else changed the price first: definitely not applied.
      if (change) await settleCatalogPriceChange(change, 'conflict', dataAdapterMode);
      throw new CatalogPriceConflictError();
    } else {
      // Outcome unknown (an error or a lost response): the item's marker
      // says whether the write landed; the history row is settled from it.
      const applied = change ? await settleFromItem(change, dataAdapterMode) : false;
      if (!applied) {
        if (failure) throw failure;
        throw new Error(`Failed to update service catalog item (HTTP ${written?.status}).`);
      }
      const reread = await readRow();
      if (!reread) throw new Error('Failed to update service catalog item.');
      updated = reread.mapped;
    }
  }

  try {
    await recordServiceCatalogPriceUpdated(params.ctx, updated.id, updated.displayName, previousPrice, updated.defaultPrice, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record serviceCatalog.price.updated activity event:', error instanceof Error ? error.message : error);
  }
  return { item: updated, previousPrice };
}
