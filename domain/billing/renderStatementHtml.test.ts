import { describe, it, expect } from 'vitest';
import { renderStatementHtml, StatementRenderError } from './renderStatementHtml';
import { FTC_CLASS, disclosuresFor, FTC_DISCLOSURE_VERSION } from './ftcComplianceRegistry';
import type { BillingStatementModel } from './billingModels';

const OFFERINGS = { offersDirectCremation: true, offersEmbalming: false, offersCaskets: false, offersOuterBurialContainers: false };

function baseModel(overrides: Partial<BillingStatementModel> = {}): BillingStatementModel {
  return {
    provider: { name: "Manor's Cremation", addressLine: '1 Main St, Springfield, IL', phone: '555-0100' },
    decedentName: 'Jane Doe',
    caseNumber: 'C-1042',
    dateOfDeath: '2026-08-01',
    generatedAt: '2026-09-01',
    orderVersion: 3,
    disclosureVersion: FTC_DISCLOSURE_VERSION,
    supplementalVersion: 0,
    lineItems: [
      { ftcClass: FTC_CLASS.BASIC_SERVICES_FEE, description: 'Direct Cremation', quantity: 1, unitPriceCents: 89000, lineTotalCents: 89000, includesBasicServicesFee: true },
      { ftcClass: FTC_CLASS.GOODS_AND_SERVICES, description: 'Oak Urn', quantity: 1, unitPriceCents: 39000, lineTotalCents: 39000, includesBasicServicesFee: false },
    ],
    basicServicesFeeMode: 'included_in_priced_service',
    goodsAndServicesTotalCents: 128000,
    paidToDateCents: 50000,
    authoritativeArBalanceDueCents: 78000,
    cashAdvanceItems: [
      { description: 'Certified death certificates (5)', amountCents: 12500, hasMarkup: false, isEstimated: false },
      { description: 'Obituary notice', amountCents: 20000, hasMarkup: true, isEstimated: true },
    ],
    cashAdvanceSubtotalCents: 32500,
    ftcStatementTotalCents: 160500,
    requiredPurchaseExplanations: null,
    offerings: OFFERINGS,
    disclosures: disclosuresFor('statement_of_goods_and_services', OFFERINGS),
    supplementalBlocks: [],
    ...overrides,
  };
}

describe('renderStatementHtml', () => {
  it('is deterministic (same model → same HTML)', () => {
    expect(renderStatementHtml(baseModel())).toBe(renderStatementHtml(baseModel()));
  });

  it('itemizes goods/services and notes the bundled basic services fee (D10)', () => {
    const html = renderStatementHtml(baseModel());
    expect(html).toContain('Direct Cremation');
    expect(html).toContain('includes our basic services fee');
    expect(html).toContain('included in the price of the direct cremation');
  });

  it('CRITICAL (D4): renders the FTC total AND the AR balance as distinct, labeled figures', () => {
    const html = renderStatementHtml(baseModel());
    // FTC total-of-arrangements = goods + cash advances = $1,605.00
    expect(html).toContain('Total cost of arrangements (this statement)');
    expect(html).toContain('$1,605.00');
    // Authoritative AR balance = CaseOrder.balanceDue = $780.00, cash advances excluded
    expect(html).toContain('Balance due to');
    expect(html).toContain('$780.00');
    // The disclaimer that cash advances are NOT in the account balance
    expect(html).toContain('not</em> included in this account balance');
  });

  it('marks estimated and marked-up cash advances', () => {
    const html = renderStatementHtml(baseModel());
    expect(html).toContain('Certified death certificates (5)');
    expect(html).toContain('Obituary notice');
    expect(html).toContain('estimated; includes a service charge');
  });

  it('renders the mandatory statement disclosures verbatim from the registry', () => {
    const html = renderStatementHtml(baseModel());
    expect(html).toContain('Charges are only for those items');
    expect(html).toContain('cash advance items');
  });

  it('surfaces unclassified lines in a distinct flagged section (never silently compliant)', () => {
    const html = renderStatementHtml(
      baseModel({
        lineItems: [{ ftcClass: FTC_CLASS.UNCLASSIFIED, description: 'Mystery fee', quantity: 1, unitPriceCents: 5000, lineTotalCents: 5000, includesBasicServicesFee: false }],
        goodsAndServicesTotalCents: 5000,
        authoritativeArBalanceDueCents: 5000,
        paidToDateCents: 0,
        cashAdvanceItems: [],
        cashAdvanceSubtotalCents: 0,
        ftcStatementTotalCents: 5000,
      }),
    );
    expect(html).toContain('pending FTC classification');
  });

  it('HTML-escapes untrusted data (XSS-safe)', () => {
    const html = renderStatementHtml(baseModel({ decedentName: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('throws if the FTC total does not reconcile with goods + cash advances', () => {
    expect(() => renderStatementHtml(baseModel({ ftcStatementTotalCents: 999999 }))).toThrow(StatementRenderError);
  });

  it('renders optional supplemental language in a clearly-separated section that does not replace disclosures', () => {
    const html = renderStatementHtml(
      baseModel({ supplementalBlocks: [{ key: 'note', document: 'statement_of_goods_and_services', text: 'We are family owned.' }] }),
    );
    expect(html).toContain('Additional Information from');
    expect(html).toContain('does not replace or modify the required disclosures');
    expect(html).toContain('We are family owned.');
  });
});
