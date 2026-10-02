import { describe, it, expect } from 'vitest';
import { renderStatementHtml, StatementRenderError } from './renderStatementHtml';
import { FTC_CLASS, disclosuresFor, FTC_DISCLOSURE_VERSION } from './ftcComplianceRegistry';
import { MANORS_STATEMENT_PROVIDER_IDENTITY } from './organizationStatementOverrides';
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
    showCashAdvanceSection: true,
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

/** A Manors-shaped model: the real provider-identity override, Cash Advance
    section suppressed, and (matching Manors' normal workflow) no cash
    advance items at all — so goodsAndServices === the FTC total. */
function manorsModel(overrides: Partial<BillingStatementModel> = {}): BillingStatementModel {
  return baseModel({
    provider: MANORS_STATEMENT_PROVIDER_IDENTITY,
    showCashAdvanceSection: false,
    cashAdvanceItems: [],
    cashAdvanceSubtotalCents: 0,
    ftcStatementTotalCents: 128000,
    ...overrides,
  });
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

describe('renderStatementHtml — Manors business identity + Cash Advance suppression (item #2, 2026-09)', () => {
  it('1: contains the street address line', () => {
    expect(renderStatementHtml(manorsModel())).toContain('481 E Commercial Blvd');
  });

  it('2: contains the city/state/zip line', () => {
    expect(renderStatementHtml(manorsModel())).toContain('Oakland Park, FL 33334');
  });

  it('3: contains the phone number', () => {
    expect(renderStatementHtml(manorsModel())).toContain('954-884-5770');
  });

  it('4: contains the fax number', () => {
    expect(renderStatementHtml(manorsModel())).toContain('305-603-9250');
  });

  it('5: contains the email address', () => {
    expect(renderStatementHtml(manorsModel())).toContain('contact@manorscremation.com');
  });

  it('6: Statement Date renders MM/DD/YYYY, not the persisted YYYY-MM-DD form', () => {
    const html = renderStatementHtml(manorsModel({ generatedAt: '2026-09-27' }));
    expect(html).toContain('09/27/2026');
    expect(html).not.toContain('2026-09-27');
  });

  it('7: the Manors logo is embedded as a data: URI in the rendered HTML', () => {
    const html = renderStatementHtml(manorsModel());
    expect(html).toContain('data:image/jpeg;base64,');
    expect(html).toContain('<img');
  });

  it("8/9: does NOT contain the Cash Advance Items heading or the empty-state placeholder", () => {
    const html = renderStatementHtml(manorsModel());
    expect(html).not.toContain('Cash Advance Items');
    expect(html).not.toContain('No cash advance items.');
  });

  it('12: totals are unaffected by suppressing the itemized section — goods/services total and FTC total remain correct and equal (no cash advances)', () => {
    const html = renderStatementHtml(manorsModel());
    expect(html).toContain('$1,280.00'); // goodsAndServicesTotalCents
    expect(html).toContain('Total cost of arrangements (this statement)');
  });

  it('11: other organizations retain their existing Cash Advance Items section unchanged', () => {
    const html = renderStatementHtml(baseModel());
    expect(html).toContain('Cash Advance Items');
    expect(html).toContain('Certified death certificates (5)');
  });

  it('stops rather than silently hiding real data: throws if Cash Advance items unexpectedly exist while the section is suppressed', () => {
    expect(() =>
      renderStatementHtml(
        manorsModel({
          cashAdvanceItems: [{ description: 'Unexpected cash advance', amountCents: 1000, hasMarkup: false, isEstimated: false }],
          cashAdvanceSubtotalCents: 1000,
          ftcStatementTotalCents: 129000,
        }),
      ),
    ).toThrow(StatementRenderError);
  });

  it('the totals table also omits the "Cash advance items" row when the section is suppressed, not just the itemized section', () => {
    const html = renderStatementHtml(manorsModel());
    expect(html).not.toContain('<td>Cash advance items</td>');
  });

  it('the visible totals table still reconciles exactly: the goods/services row is immediately followed by the total row, with no cash-advance row between them', () => {
    const html = renderStatementHtml(manorsModel());
    const tbody = html.split('Total Cost of Arrangements')[1].split('</tbody>')[0];
    expect(tbody).not.toContain('Cash advance items');
    expect(tbody.indexOf('Funeral goods and services')).toBeGreaterThanOrEqual(0);
    expect(tbody.indexOf('Total cost of arrangements (this statement)')).toBeGreaterThan(tbody.indexOf('Funeral goods and services'));
  });

  it('other organizations keep their "Cash advance items" totals row unchanged', () => {
    const html = renderStatementHtml(baseModel());
    expect(html).toContain('<td>Cash advance items</td>');
    expect(html).toContain('$325.00'); // cashAdvanceSubtotalCents
  });
});

describe('renderStatementHtml — redundant branding cleanup (Manors cleanup phase, Task #2)', () => {
  it('does not render the business name as a separate text line beneath the logo', () => {
    const html = renderStatementHtml(manorsModel());
    expect(html).not.toContain(`<p style="margin:0; font-size:1.05em; font-weight:bold; letter-spacing:0.3px;">${MANORS_STATEMENT_PROVIDER_IDENTITY.name}</p>`);
  });

  it('still renders the logo, address, and contact lines (only the redundant name text was removed)', () => {
    const html = renderStatementHtml(manorsModel());
    expect(html).toContain('<img');
    expect(html).toContain('481 E Commercial Blvd');
    expect(html).toContain('954-884-5770');
  });

  it('does not render the redundant top heading', () => {
    const html = renderStatementHtml(manorsModel());
    expect(html).not.toContain('Statement of Funeral Goods and Services Selected');
  });

  it('still renders the decedent/case identification and required disclosures below the header', () => {
    const html = renderStatementHtml(manorsModel());
    expect(html).toContain('Jane Doe');
    expect(html).toContain('C-1042');
    expect(html).toContain('Charges are only for those items');
  });
});
