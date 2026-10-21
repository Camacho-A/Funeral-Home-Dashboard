import { describe, expect, it } from 'vitest';
import { STANDARD_ITEM_CODES, itemCodesForLines, usesReadableItemCodes, type ItemCodeLine } from './itemCode';
import { SERVICE_CODES } from '../pricing/serviceCodes';
import { renderStatementHtml } from './renderStatementHtml';
import { FTC_CLASS } from './ftcComplianceRegistry';
import type { BillingStatementModel, StatementLineItem } from './billingModels';

const line = (lineKind: ItemCodeLine['lineKind'], serviceCode: string, sortOrder: number): ItemCodeLine => ({ lineKind, serviceCode, sortOrder });

describe('itemCodesForLines — readable item codes (2026-10)', () => {
  it('gives every standard catalogue service a fixed, readable code', () => {
    expect(Object.keys(STANDARD_ITEM_CODES).sort()).toEqual(Object.values(SERVICE_CODES).sort());
    expect(itemCodesForLines(Object.values(SERVICE_CODES).map((code, i) => line('service', code, i)))).toEqual([
      'CREM-001', 'WT-001', 'WT-002', 'DC-001', 'MAIL-001', 'XFER-001', 'XFER-002', 'SHIP-001',
    ]);
    expect(new Set(Object.values(STANDARD_ITEM_CODES)).size).toBe(Object.values(STANDARD_ITEM_CODES).length);
  });

  it('numbers custom items CUST-001, CUST-002 … by the order\'s own line order, never exposing their ids', () => {
    const lines = [
      line('custom', 'custom:466ae939-90de-4937-97c5-ebdda90741df', 1010),
      line('service', SERVICE_CODES.DIRECT_CREMATION, 0),
      line('custom', 'custom:0d1c2b3a-1111-4222-8333-944455556666', 1000),
    ];
    expect(itemCodesForLines(lines)).toEqual(['CUST-002', 'CREM-001', 'CUST-001']);
  });

  it('is stable: the same lines always get the same codes, whatever order they are passed in', () => {
    const lines = [line('custom', 'custom:a', 1000), line('custom', 'custom:b', 1010), line('service', SERVICE_CODES.SHIPPING, 50)];
    const forward = itemCodesForLines(lines);
    const reversed = itemCodesForLines([...lines].reverse()).reverse();
    expect(reversed).toEqual(forward);
  });

  it('keeps a readable merchandise SKU; a messy one becomes MERCH-nnn', () => {
    expect(itemCodesForLines([line('merchandise', 'urn-oak-01', 1), line('merchandise', 'sku_internal:9f3c', 2), line('merchandise', '466ae939-90de-4937-97c5-ebdda90741df', 3)])).toEqual([
      'URN-OAK-01',
      'MERCH-001',
      'MERCH-002',
    ]);
  });

  it('an unmapped service never prints its raw key', () => {
    const [code] = itemCodesForLines([line('service', 'OTHER_FEE_2026', 1)]);
    expect(code).toBe('SVC-001');
  });

  it('is on for Manors only', () => {
    expect(usesReadableItemCodes('managed-cremations')).toBe(true);
    expect(usesReadableItemCodes('gus-camacho-jr')).toBe(false);
  });
});

describe('renderStatementHtml — Item # column (2026-10)', () => {
  const statementLine = (overrides: Partial<StatementLineItem>): StatementLineItem => ({
    ftcClass: FTC_CLASS.GOODS_AND_SERVICES,
    description: 'Direct Cremation',
    quantity: 1,
    unitPriceCents: 89_000,
    lineTotalCents: 89_000,
    includesBasicServicesFee: false,
    ...overrides,
  });
  const model = (overrides: Partial<BillingStatementModel>): BillingStatementModel =>
    ({
      provider: { name: 'Manors Cremation Services', addressLine: '481 E Commercial Blvd', phone: '954-884-5770' },
      decedentName: 'Test Person',
      caseNumber: 'B2026-999',
      dateOfDeath: '10/01/2026',
      generatedAt: '2026-10-21',
      orderVersion: 1,
      disclosureVersion: 'v1',
      supplementalVersion: 1,
      lineItems: [],
      basicServicesFeeMode: 'separately_charged',
      goodsAndServicesTotalCents: 0,
      paidToDateCents: 0,
      authoritativeArBalanceDueCents: 0,
      showCashAdvanceSection: false,
      cashAdvanceItems: [],
      cashAdvanceSubtotalCents: 0,
      ftcStatementTotalCents: 0,
      requiredPurchaseExplanations: null,
      offerings: { offersCremation: true, offersBurial: false, offersEmbalming: false, offersViewing: false, offersCaskets: false, offersOuterBurialContainers: false } as never,
      disclosures: [],
      supplementalBlocks: [],
      ...overrides,
    }) as BillingStatementModel;

  it('with codes on: an Item # column, codes on one line, long descriptions wrap, multiple lines, totals intact', () => {
    const long = 'Transportation outside of Broward County, including mileage and an additional staff member for the removal';
    const lines = [
      statementLine({ itemCode: 'CREM-001' }),
      statementLine({ itemCode: 'CUST-001', description: long, unitPriceCents: 15_000, lineTotalCents: 15_000 }),
      statementLine({ itemCode: 'DC-001', description: 'Extra Death Certificate', quantity: 3, unitPriceCents: 1_000, lineTotalCents: 3_000 }),
    ];
    const html = renderStatementHtml(model({ showItemCodes: true, lineItems: lines, goodsAndServicesTotalCents: 107_000, ftcStatementTotalCents: 107_000, authoritativeArBalanceDueCents: 107_000 }));
    expect(html).toMatch(/<th style="width:13%; white-space:nowrap;[^"]*">Item #<\/th><th style="text-align:left;">Description<\/th>/);
    for (const code of ['CREM-001', 'CUST-001', 'DC-001']) expect(html).toMatch(new RegExp(`white-space:nowrap;[^"]*">${code}</td>`));
    expect(html).toContain(`overflow-wrap:anywhere;">${long}`);
    expect(html).toContain('<td colspan="4">Total funeral goods and services</td>');
    expect(html).toContain('$1,070.00');
  });

  it('with codes off (every other organization): exactly the previous table', () => {
    const html = renderStatementHtml(model({ lineItems: [statementLine({})], goodsAndServicesTotalCents: 89_000, ftcStatementTotalCents: 89_000 }));
    expect(html).not.toContain('Item #');
    expect(html).toContain('<th style="text-align:left;">Item</th><th>Qty</th>');
    expect(html).toContain('<td colspan="3">Total funeral goods and services</td>');
  });
});
