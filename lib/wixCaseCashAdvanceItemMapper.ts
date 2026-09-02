import type { CaseCashAdvanceItem } from '../types/caseCashAdvanceItem';

/**
 * Phase 39 (Family Billing & FTC Compliance). The one place a raw Wix
 * `caseCashAdvanceItems` row is touched. Security-critical scalars fail
 * closed; `amountCents` must be a number (never coerced from a string).
 */
export type WixCaseCashAdvanceItem = {
  beaconCaseCashAdvanceItemId?: unknown;
  organizationId?: unknown;
  caseId?: unknown;
  description?: unknown;
  amountCents?: unknown;
  hasMarkup?: unknown;
  isEstimated?: unknown;
  isActive?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixCaseCashAdvanceItem(item: WixCaseCashAdvanceItem | undefined): CaseCashAdvanceItem | null {
  if (
    !item ||
    typeof item.beaconCaseCashAdvanceItemId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.caseId !== 'string' ||
    typeof item.description !== 'string' ||
    typeof item.amountCents !== 'number' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    id: item.beaconCaseCashAdvanceItemId,
    organizationId: item.organizationId,
    caseId: item.caseId,
    description: item.description,
    amountCents: item.amountCents,
    hasMarkup: item.hasMarkup === true,
    isEstimated: item.isEstimated === true,
    isActive: item.isActive !== false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixCaseCashAdvanceItemData(entry: CaseCashAdvanceItem): WixCaseCashAdvanceItem {
  return {
    beaconCaseCashAdvanceItemId: entry.id,
    organizationId: entry.organizationId,
    caseId: entry.caseId,
    description: entry.description,
    amountCents: entry.amountCents,
    hasMarkup: entry.hasMarkup,
    isEstimated: entry.isEstimated,
    isActive: entry.isActive,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
