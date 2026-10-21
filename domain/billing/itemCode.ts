import type { CaseOrderLineItem } from '../../types/caseOrder';
import { SERVICE_CODES } from '../pricing/serviceCodes';
import { getRegisteredOrganizationProfile } from '../organization/organizationProfiles';

/**
 * Readable item codes (2026-10). What a family sees in the Item # column of
 * the Receipt of Payment and the Statement of Funeral Goods and Services —
 * never an internal identifier. Customer-facing documents used to show raw
 * keys like `DIRECT_CREMATION` or `custom:466ae939-…`, which mean nothing to
 * a family.
 *
 * Display only. A line's `serviceCode` is untouched and keeps driving
 * pricing, orders and payments; nothing here changes an amount.
 *
 *   Standard catalogue services   fixed codes (STANDARD_ITEM_CODES below)
 *   Merchandise                   its SKU when the SKU is a readable product
 *                                 number, otherwise MERCH-001, MERCH-002, …
 *   Custom (staff-entered) items  CUST-001, CUST-002, … in the order's own
 *                                 line order
 *   Any other / unmapped service  SVC-001, SVC-002, … (never the raw key)
 *
 * Numbered codes count within one order's lines, sorted by `sortOrder`, so
 * the same order always prints the same codes on both documents.
 */
export const STANDARD_ITEM_CODES: Readonly<Record<string, string>> = Object.freeze({
  [SERVICE_CODES.DIRECT_CREMATION]: 'CREM-001',
  [SERVICE_CODES.WEIGHT_SURCHARGE_201_250]: 'WT-001',
  [SERVICE_CODES.WEIGHT_SURCHARGE_251_300]: 'WT-002',
  [SERVICE_CODES.EXTRA_DEATH_CERTIFICATE]: 'DC-001',
  [SERVICE_CODES.MAIL_CREMATED_REMAINS]: 'MAIL-001',
  [SERVICE_CODES.KEEPSAKE_TRANSFER]: 'XFER-001',
  [SERVICE_CODES.URN_TRANSFER]: 'XFER-002',
  [SERVICE_CODES.SHIPPING]: 'SHIP-001',
});

/** Whether this organization prints readable item codes (Manors only today). */
export function usesReadableItemCodes(organizationId: string | null | undefined): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.readableItemCodes;
}

const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A SKU a family can read as a product number: short, letters/digits with
    single dashes, and nothing that looks like an internal id. */
function isReadableSku(sku: string): boolean {
  const trimmed = sku.trim();
  return /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(trimmed) && trimmed.length <= 16 && !UUID_LIKE.test(trimmed);
}

const pad = (n: number) => String(n).padStart(3, '0');

export type ItemCodeLine = Pick<CaseOrderLineItem, 'lineKind' | 'serviceCode' | 'sortOrder'>;

/**
 * The display code for every line, in the order given. Numbered codes are
 * assigned in `sortOrder` order (ties keep the given order), so they do not
 * depend on how a caller happens to sort the lines.
 */
export function itemCodesForLines(lines: readonly ItemCodeLine[]): string[] {
  const order = lines.map((line, index) => ({ line, index })).sort((a, b) => a.line.sortOrder - b.line.sortOrder || a.index - b.index);
  const counters = { CUST: 0, MERCH: 0, SVC: 0, ITEM: 0 };
  const codes: string[] = new Array(lines.length);
  for (const { line, index } of order) {
    const standard = line.lineKind === 'service' ? STANDARD_ITEM_CODES[line.serviceCode] : undefined;
    if (standard) {
      codes[index] = standard;
    } else if (line.lineKind === 'merchandise' && isReadableSku(line.serviceCode ?? '')) {
      codes[index] = line.serviceCode.trim().toUpperCase();
    } else {
      const prefix = line.lineKind === 'custom' ? 'CUST' : line.lineKind === 'merchandise' ? 'MERCH' : line.lineKind === 'service' ? 'SVC' : 'ITEM';
      counters[prefix] += 1;
      codes[index] = `${prefix}-${pad(counters[prefix])}`;
    }
  }
  return codes;
}
