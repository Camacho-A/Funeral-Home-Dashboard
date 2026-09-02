import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import { mapWixCaseCashAdvanceItem, buildWixCaseCashAdvanceItemData, type WixCaseCashAdvanceItem } from '../lib/wixCaseCashAdvanceItemMapper';
import type { CaseCashAdvanceItem } from '../types/caseCashAdvanceItem';
import { caseCashAdvanceItemFixtures } from './__mocks__/billingFixtures';

/**
 * Phase 39 (Family Billing & FTC Compliance). Sole writer of
 * `caseCashAdvanceItems`. These rows are DISPLAY-ONLY compliance data (D4):
 * this service never touches the GL, AR, `CaseOrder`, `PaymentService`, or
 * financial reporting — it is deliberately isolated from every accounting
 * path. It only records the third-party cash-advance items the FTC Statement
 * must itemize.
 */
const COLLECTION = 'caseCashAdvanceItems';

export class CashAdvanceServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashAdvanceServiceError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function listCashAdvanceItems(
  organizationId: string,
  caseId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseCashAdvanceItem[]> {
  if (dataAdapterMode === 'mock') {
    return caseCashAdvanceItemFixtures.filter((c) => c.organizationId === organizationId && c.caseId === caseId && c.isActive);
  }
  const response = await queryWixDataItems<WixCaseCashAdvanceItem>(COLLECTION, { filter: { organizationId, caseId } });
  return response.dataItems
    .map((item) => mapWixCaseCashAdvanceItem(item.data))
    .filter((c): c is CaseCashAdvanceItem => c !== null && c.isActive);
}

export async function createCashAdvanceItem(
  params: {
    organizationId: string;
    caseId: string;
    description: string;
    amountCents: number;
    hasMarkup: boolean;
    isEstimated: boolean;
    idFactory: () => string;
  },
  dataAdapterMode: DataAdapterMode,
): Promise<CaseCashAdvanceItem> {
  const description = params.description.trim();
  if (description.length === 0) throw new CashAdvanceServiceError('A cash advance item requires a description.');
  if (!Number.isInteger(params.amountCents) || params.amountCents < 0) {
    throw new CashAdvanceServiceError('A cash advance amount must be a non-negative integer number of cents.');
  }
  const now = nowIso();
  const item: CaseCashAdvanceItem = {
    id: params.idFactory(),
    organizationId: params.organizationId,
    caseId: params.caseId,
    description,
    amountCents: params.amountCents,
    hasMarkup: params.hasMarkup,
    isEstimated: params.isEstimated,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  if (dataAdapterMode === 'mock') {
    caseCashAdvanceItemFixtures.push(item);
    return item;
  }
  await insertWixDataItem<WixCaseCashAdvanceItem>(COLLECTION, buildWixCaseCashAdvanceItemData(item), item.id);
  return item;
}

async function findOwned(
  organizationId: string,
  caseId: string,
  itemId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ item: CaseCashAdvanceItem; wixItemId?: string }> {
  if (dataAdapterMode === 'mock') {
    const item = caseCashAdvanceItemFixtures.find((c) => c.id === itemId && c.organizationId === organizationId && c.caseId === caseId);
    if (!item) throw new CashAdvanceServiceError('Cash advance item not found.');
    return { item };
  }
  const response = await queryWixDataItems<WixCaseCashAdvanceItem>(COLLECTION, {
    filter: { organizationId, caseId, beaconCaseCashAdvanceItemId: itemId },
    paging: { limit: 1 },
  });
  const row = response.dataItems[0];
  const mapped = mapWixCaseCashAdvanceItem(row?.data);
  if (!row || !mapped) throw new CashAdvanceServiceError('Cash advance item not found.');
  return { item: mapped, wixItemId: row.id };
}

export async function updateCashAdvanceItem(
  organizationId: string,
  caseId: string,
  itemId: string,
  patch: Partial<Pick<CaseCashAdvanceItem, 'description' | 'amountCents' | 'hasMarkup' | 'isEstimated'>>,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseCashAdvanceItem> {
  if (patch.amountCents !== undefined && (!Number.isInteger(patch.amountCents) || patch.amountCents < 0)) {
    throw new CashAdvanceServiceError('A cash advance amount must be a non-negative integer number of cents.');
  }
  const { item, wixItemId } = await findOwned(organizationId, caseId, itemId, dataAdapterMode);
  const merged: CaseCashAdvanceItem = {
    ...item,
    description: patch.description !== undefined ? patch.description.trim() : item.description,
    amountCents: patch.amountCents ?? item.amountCents,
    hasMarkup: patch.hasMarkup ?? item.hasMarkup,
    isEstimated: patch.isEstimated ?? item.isEstimated,
    updatedAt: nowIso(),
  };
  if (dataAdapterMode === 'mock') {
    const idx = caseCashAdvanceItemFixtures.findIndex((c) => c.id === itemId);
    caseCashAdvanceItemFixtures[idx] = merged;
    return merged;
  }
  await updateWixDataItem<WixCaseCashAdvanceItem>(COLLECTION, wixItemId!, buildWixCaseCashAdvanceItemData(merged));
  return merged;
}

/** Archive (soft-delete) a cash advance item — never a hard delete. */
export async function archiveCashAdvanceItem(
  organizationId: string,
  caseId: string,
  itemId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseCashAdvanceItem> {
  const { item, wixItemId } = await findOwned(organizationId, caseId, itemId, dataAdapterMode);
  const archived: CaseCashAdvanceItem = { ...item, isActive: false, updatedAt: nowIso() };
  if (dataAdapterMode === 'mock') {
    const idx = caseCashAdvanceItemFixtures.findIndex((c) => c.id === itemId);
    caseCashAdvanceItemFixtures[idx] = archived;
    return archived;
  }
  await updateWixDataItem<WixCaseCashAdvanceItem>(COLLECTION, wixItemId!, buildWixCaseCashAdvanceItemData(archived));
  return archived;
}

/** Sum of active cash advances for a case — the FTC cash-advance subtotal.
    NOT an accounting figure; never fed to AR/GL/PaymentService. */
export function sumCashAdvances(items: CaseCashAdvanceItem[]): number {
  return items.reduce((total, item) => total + item.amountCents, 0);
}
