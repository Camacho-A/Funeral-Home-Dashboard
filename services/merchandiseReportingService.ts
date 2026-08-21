import type { DataAdapterMode } from '../lib/env';
import { getAccountByNumber } from './chartOfAccountsService';
import { getAccountBalance } from './generalLedgerService';
import { listBalancesForOrganization } from './inventoryService';
import { listProductsForOrganization } from './merchandiseService';
import { isLowStock } from '../domain/merchandise/inventoryMath';
import { STARTER_ACCOUNT_NUMBERS } from '../domain/ledger/starterChartOfAccounts';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). The metric resolvers behind
 * the Phase 32 reporting registry's new commerce/inventory metrics — read-
 * only compositions over the canonical services, never a parallel
 * calculation. FINANCIAL figures (revenue, COGS, margin) derive strictly
 * from the Phase 31 ledger; INVENTORY figures (asset value, low-stock)
 * derive from the authoritative movement-backed balances. See
 * docs/adr/ADR-039-merchandise-inventory-and-commerce.md §23.
 */

async function ledgerAccountBalance(organizationId: string, accountNumber: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const account = await getAccountByNumber(organizationId, accountNumber, dataAdapterMode);
  if (!account) return 0;
  return getAccountBalance(organizationId, account.id, dataAdapterMode);
}

/** Merchandise Revenue (4100). Revenue is credit-normal, so getAccountBalance
    (Σ debit − credit) is negative for a credit balance — negate to a positive
    revenue figure. */
export async function merchandiseRevenue(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  return -(await ledgerAccountBalance(organizationId, STARTER_ACCOUNT_NUMBERS.MERCHANDISE_REVENUE, dataAdapterMode));
}

/** Cost of Goods Sold (5100). Expense is debit-normal → already positive. */
export async function merchandiseCogs(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  return ledgerAccountBalance(organizationId, STARTER_ACCOUNT_NUMBERS.COST_OF_GOODS_SOLD, dataAdapterMode);
}

export async function merchandiseGrossMargin(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const [revenue, cogs] = await Promise.all([merchandiseRevenue(organizationId, dataAdapterMode), merchandiseCogs(organizationId, dataAdapterMode)]);
  return revenue - cogs;
}

/** Inventory asset value = Σ on-hand × product cost, across every stock line.
    Reads INTERNAL cost server-side (never surfaced to family). */
export async function inventoryAssetValue(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const [balances, products] = await Promise.all([
    listBalancesForOrganization(organizationId, dataAdapterMode),
    listProductsForOrganization(organizationId, dataAdapterMode, { includeInactive: true }),
  ]);
  const costById = new Map(products.map((p) => [p.id, p.cost]));
  return balances.reduce((sum, b) => sum + b.onHand * (costById.get(b.productId) ?? 0), 0);
}

/** Total units on hand across the whole organization. */
export async function inventoryOnHandUnits(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const balances = await listBalancesForOrganization(organizationId, dataAdapterMode);
  return balances.reduce((sum, b) => sum + b.onHand, 0);
}

/** Count of distinct products at or below their reorder point (at any
    location). */
export async function lowStockProductCount(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const [balances, products] = await Promise.all([
    listBalancesForOrganization(organizationId, dataAdapterMode),
    listProductsForOrganization(organizationId, dataAdapterMode, { includeInactive: false }),
  ]);
  const reorderById = new Map(products.map((p) => [p.id, p.reorderPoint]));
  const lowProducts = new Set<string>();
  for (const b of balances) {
    if (isLowStock(b.onHand, reorderById.get(b.productId) ?? null)) lowProducts.add(b.productId);
  }
  return lowProducts.size;
}
