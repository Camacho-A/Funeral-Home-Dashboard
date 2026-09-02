import { describe, it, expect } from 'vitest';
import { renderGeneralPriceListHtml } from './renderGeneralPriceListHtml';
import { FTC_CLASS, disclosuresFor, FTC_DISCLOSURE_VERSION } from './ftcComplianceRegistry';
import type { GeneralPriceListModel } from './billingModels';

const DIRECT_CREMATION_ONLY = { offersDirectCremation: true, offersEmbalming: false, offersCaskets: false, offersOuterBurialContainers: false };

function model(overrides: Partial<GeneralPriceListModel> = {}): GeneralPriceListModel {
  return {
    provider: { name: "Manor's Cremation", addressLine: '1 Main St', phone: '555-0100' },
    effectiveDate: '2026-09-01',
    generatedAt: '2026-09-01',
    disclosureVersion: FTC_DISCLOSURE_VERSION,
    supplementalVersion: 0,
    serviceLines: [
      { category: 'base', displayName: 'Direct Cremation', priceCents: 89000, ftcClass: FTC_CLASS.BASIC_SERVICES_FEE, includesBasicServicesFee: true },
      { category: 'addon', displayName: 'Mail Cremated Remains', priceCents: 18500, ftcClass: FTC_CLASS.GOODS_AND_SERVICES, includesBasicServicesFee: false },
    ],
    merchandiseLines: [{ category: 'urn', name: 'Oak Urn', priceCents: 39000 }],
    offerings: DIRECT_CREMATION_ONLY,
    disclosures: disclosuresFor('general_price_list', DIRECT_CREMATION_ONLY),
    supplementalBlocks: [],
    ...overrides,
  };
}

describe('renderGeneralPriceListHtml', () => {
  it('is deterministic', () => {
    expect(renderGeneralPriceListHtml(model())).toBe(renderGeneralPriceListHtml(model()));
  });

  it('lists configured services + merchandise with the effective date', () => {
    const html = renderGeneralPriceListHtml(model());
    expect(html).toContain('Direct Cremation');
    expect(html).toContain('$890.00');
    expect(html).toContain('Oak Urn');
    expect(html).toContain('effective as of 2026-09-01');
  });

  it('renders the direct-cremation alternative-container disclosure but NOT casket/OBC/embalming (D7)', () => {
    const html = renderGeneralPriceListHtml(model());
    expect(html).toContain('alternative container');
    expect(html).not.toContain('caskets we offer for sale');
    expect(html).not.toContain('outer burial containers');
    expect(html).not.toContain('embalming is not required by law');
  });

  it('notes the basic services fee is included in the direct-cremation price', () => {
    expect(renderGeneralPriceListHtml(model())).toContain('includes our basic services fee');
  });

  it('does not invent product sections when none are configured', () => {
    const html = renderGeneralPriceListHtml(model({ merchandiseLines: [] }));
    expect(html).not.toContain('>Merchandise<');
  });

  it('HTML-escapes provider/product data', () => {
    const html = renderGeneralPriceListHtml(model({ provider: { name: '<b>x</b>', addressLine: 'a', phone: 'p' } }));
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
