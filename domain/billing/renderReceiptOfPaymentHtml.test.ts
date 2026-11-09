import { describe, expect, it } from 'vitest';
import { renderReceiptOfPaymentHtml } from './renderReceiptOfPaymentHtml';
import type { ReceiptOfPaymentModel } from './receiptOfPayment';

/**
 * Layout fidelity to Manors' own "MANORS RECEIPT OF PAYMENT" document,
 * plus the rule that matters most: the receipt never claims more than the
 * records support.
 */
function model(overrides: Partial<ReceiptOfPaymentModel> = {}): ReceiptOfPaymentModel {
  return {
    provider: {
      name: 'MANORS CREMATION',
      addressLine: '481 E. Commercial Blvd.\nOakland Park, FL 33334',
      phone: '(954) 884-5770',
      fax: undefined,
      email: undefined,
      logoDataUri: 'data:image/png;base64,AAAA',
    },
    footer: { thanksLine: 'Thank you for your trust in Cremations America of Broward, LLC', legalEntityLine: 'DBA MANORS CREMATION' },
    statementDateDisplay: 'November 12, 2025',
    caseNumber: 'B2025-013',
    soldToName: 'SANDRA CHEVELE PALMER',
    deceasedName: 'GEORGE RICKEY PRINCE',
    dateOfDeathDisplay: 'May 21, 2025',
    status: 'paid_in_full',
    paidInFullDateDisplay: 'May 21, 2025',
    payments: [{ methodLabel: 'Credit Card', paidAtDisplay: 'May 21, 2025', amountCents: 89_000 }],
    lineItems: [{ quantity: 1, itemNumber: null, description: 'Direct Cremation', costCents: 89_000, discountCents: 0, totalCents: 89_000 }],
    totalChargeCents: 89_000,
    discountCents: 0,
    paymentCents: 89_000,
    refunds: [],
    chargesReducedCents: 0,
    refundCents: 0,
    balanceDueCents: 0,
    missingFields: [],
    ...overrides,
  };
}

describe('renderReceiptOfPaymentHtml — reproduces the Manors document', () => {
  it('carries every heading and label from the original', () => {
    const html = renderReceiptOfPaymentHtml(model());
    for (const text of [
      'Receipt of Payment', 'MANORS CREMATION', 'Date: November 12, 2025', 'Contract # B2025-013',
      'SOLD TO:', 'Payment Method / Date Paid', 'Date of Death', 'Deceased',
      'Qty', 'Item #', 'Description', 'Cost', 'Discount', 'Total',
      'TOTAL CHARGE', 'DISCOUNT', 'PAYMENT', 'BALANCE DUE',
    ]) {
      expect(html, text).toContain(text);
    }
  });

  it('keeps the footer naming the legal entity', () => {
    const html = renderReceiptOfPaymentHtml(model());
    expect(html).toContain('Thank you for your trust in Cremations America of Broward, LLC');
    expect(html).toContain('DBA MANORS CREMATION');
    expect(html).toContain('(954) 884-5770');
    expect(html).toContain('481 E. Commercial Blvd.');
  });

  it('embeds the logo', () => {
    expect(renderReceiptOfPaymentHtml(model())).toContain('data:image/png;base64,AAAA');
  });

  it('shows real case and family data, not the example family', () => {
    const html = renderReceiptOfPaymentHtml(
      model({ caseNumber: 'B2026-038', soldToName: 'MARCIA SHALLOW', deceasedName: 'JOYCE BEVERLY GOLLIS' }),
    );
    expect(html).toContain('B2026-038');
    expect(html).toContain('MARCIA SHALLOW');
    expect(html).toContain('JOYCE BEVERLY GOLLIS');
    expect(html).not.toContain('Sandra Chevele Palmer');
    expect(html).not.toContain('George Rickey Prince');
  });

  it('includes the deceased middle name as composed upstream', () => {
    expect(renderReceiptOfPaymentHtml(model({ deceasedName: 'JOYCE BEVERLY GOLLIS' }))).toContain('JOYCE BEVERLY GOLLIS');
  });
});

describe('renderReceiptOfPaymentHtml — payment status', () => {
  it('states PAID IN FULL with its date when the balance is cleared', () => {
    const html = renderReceiptOfPaymentHtml(model());
    expect(html).toContain('PAID IN FULL');
    expect(html).toContain('May 21, 2025');
  });

  it('a partial payment shows the amount actually paid, and the remainder as Balance Due (2026-10)', () => {
    const html = renderReceiptOfPaymentHtml(
      model({ status: 'partial_payment', paidInFullDateDisplay: null, totalChargeCents: 94_000, paymentCents: 50_000, balanceDueCents: 44_000 }),
    );
    expect(html).toContain('PARTIAL PAYMENT:&nbsp; $500.00');
    expect(html).toContain('Balance Due:&nbsp; $440.00');
    // The remaining balance is never labelled as a partial payment.
    expect(html).not.toContain('PARTIAL PAYMENT:&nbsp; $440.00');
    expect(html).not.toContain('PAID IN FULL');
  });

  it('an unpaid case shows Balance Due for the full amount, and no partial payment', () => {
    const html = renderReceiptOfPaymentHtml(
      model({ status: 'balance_due', paidInFullDateDisplay: null, payments: [], paymentCents: 0, balanceDueCents: 89_000 }),
    );
    expect(html).toContain('Balance Due:&nbsp; $890.00');
    expect(html).not.toContain('PARTIAL PAYMENT');
    expect(html).not.toContain('PAID IN FULL');
  });

  it('a final payment shows PAID IN FULL with its date and no Balance Due line', () => {
    const html = renderReceiptOfPaymentHtml(model());
    expect(html).toContain('PAID IN FULL:&nbsp; May 21, 2025');
    expect(html).not.toContain('Balance Due:');
    expect(html).not.toContain('PARTIAL PAYMENT');
  });

  it('lists every payment when there are several, with their own methods', () => {
    const html = renderReceiptOfPaymentHtml(
      model({
        payments: [
          { methodLabel: 'Visa ••4242', paidAtDisplay: 'May 1, 2025', amountCents: 40_000 },
          { methodLabel: 'Check', paidAtDisplay: 'May 21, 2025', amountCents: 49_000 },
        ],
      }),
    );
    expect(html).toContain('Visa ••4242');
    expect(html).toContain('Check');
    expect(html).toContain('May 1, 2025');
  });
});

describe('renderReceiptOfPaymentHtml — charges', () => {
  it('itemises multiple services with their discounts', () => {
    const html = renderReceiptOfPaymentHtml(
      model({
        lineItems: [
          { quantity: 1, itemNumber: 'DIRECT_CREMATION', description: 'Direct Cremation', costCents: 89_000, discountCents: 0, totalCents: 89_000 },
          { quantity: 3, itemNumber: 'DEATH_CERT', description: 'Extra Death Certificates', costCents: 1_500, discountCents: 500, totalCents: 4_000 },
        ],
        totalChargeCents: 93_000,
        discountCents: 500,
      }),
    );
    expect(html).toContain('Direct Cremation');
    expect(html).toContain('Extra Death Certificates');
    expect(html).toContain('DEATH_CERT');
    expect(html).toContain('$5.00');
    expect(html).toContain('$930.00');
  });

  it('says so plainly when there are no charges rather than showing an empty table', () => {
    const html = renderReceiptOfPaymentHtml(model({ lineItems: [] }));
    expect(html).toContain('No itemised charges are recorded');
  });

  it('shows a missing identity field as a dash, never as a blank that looks deliberate', () => {
    const html = renderReceiptOfPaymentHtml(model({ soldToName: null, dateOfDeathDisplay: null }));
    expect(html).toContain('&mdash;');
  });

  it('leaves an absent Item # blank, as the original document does', () => {
    // The optional catalogue-code column is empty on the real receipt for
    // a service that has no code — dashing it would add noise the
    // original does not have.
    const html = renderReceiptOfPaymentHtml(
      model({ lineItems: [{ quantity: 1, itemNumber: null, description: 'Direct Cremation', costCents: 89_000, discountCents: 0, totalCents: 89_000 }] }),
    );
    expect(html).toMatch(/white-space:nowrap;">\s*<\/td>/);
  });

  it('escapes user-supplied values', () => {
    const html = renderReceiptOfPaymentHtml(model({ deceasedName: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderReceiptOfPaymentHtml — organization isolation', () => {
  it("never puts Manors' legal entity on another organization's receipt", () => {
    const html = renderReceiptOfPaymentHtml(
      model({
        provider: { name: 'GUS CAMACHO JR. FUNERAL HOME', addressLine: '1 Main St\nMiami, FL', phone: '(305) 555-0100', fax: undefined, email: undefined, logoDataUri: undefined },
        footer: { thanksLine: 'Thank you for your trust in GUS CAMACHO JR. FUNERAL HOME', legalEntityLine: null },
      }),
    );
    expect(html).toContain('GUS CAMACHO JR. FUNERAL HOME');
    expect(html).not.toContain('Cremations America of Broward');
    expect(html).not.toContain('DBA MANORS CREMATION');
    expect(html).not.toContain('954) 884-5770');
  });
});

describe('renderReceiptOfPaymentHtml — readable item codes (2026-10)', () => {
  it('keeps a code on one line and lets a long description wrap', () => {
    const long = 'Direct Cremation including transportation of the deceased from the place of death within Broward County and all required permits';
    const html = renderReceiptOfPaymentHtml(
      model({ lineItems: [{ quantity: 1, itemNumber: 'CREM-001', description: long, costCents: 89_000, discountCents: 0, totalCents: 89_000 }] }),
    );
    expect(html).toMatch(/white-space:nowrap;">CREM-001<\/td>/);
    expect(html).toContain('overflow-wrap:anywhere;">' + long);
    expect(html).toMatch(/width:13%;">Item #/);
  });
});

describe('renderReceiptOfPaymentHtml — refunds (2026-11)', () => {
  const summary = (html: string) =>
    [...html.matchAll(/<td style="[^"]*background:#efefef;">([A-Z ]+)<\/td>\s*<td style="[^"]*">([^<]*)<\/td>/g)].map((m) => [m[1], m[2]]);

  it('no refund: the summary reads exactly as before', () => {
    const html = renderReceiptOfPaymentHtml(model());
    expect(summary(html)).toEqual([
      ['TOTAL CHARGE', '$890.00'],
      ['DISCOUNT', ''],
      ['PAYMENT', '$890.00'],
      ['BALANCE DUE', '$0.00'],
    ]);
    expect(html).not.toContain('REFUND');
    expect(html).not.toContain('Refunded');
  });

  it('service removed: the refund is a minus taken off the total charge, and the column adds up', () => {
    const html = renderReceiptOfPaymentHtml(
      model({
        refunds: [{ methodLabel: 'Check — 2001', paidAtDisplay: 'June 2, 2025', amountCents: 15_000, reducedCharges: true }],
        chargesReducedCents: 15_000,
        refundCents: 15_000,
      }),
    );
    expect(summary(html)).toEqual([
      ['TOTAL CHARGE', '$890.00'],
      ['DISCOUNT', ''],
      ['REFUND', '&minus;$150.00'],
      ['TOTAL AFTER REFUND', '$740.00'],
      ['PAYMENT', '$740.00'],
      ['BALANCE DUE', '$0.00'],
    ]);
    expect(html).toContain('REFUND &mdash; Check — 2001 &nbsp; June 2, 2025: &nbsp; &minus;$150.00');
    expect(html).toContain('Refunded:&nbsp; &minus;$150.00');
  });

  it('family overpaid: the total stands, and the refund is a minus taken off the payment', () => {
    const html = renderReceiptOfPaymentHtml(
      model({
        payments: [{ methodLabel: 'Check — 1042', paidAtDisplay: 'May 21, 2025', amountCents: 100_000 }],
        refunds: [{ methodLabel: 'Check — 2001', paidAtDisplay: 'June 2, 2025', amountCents: 11_000, reducedCharges: false }],
        paymentCents: 100_000,
        refundCents: 11_000,
      }),
    );
    expect(summary(html)).toEqual([
      ['TOTAL CHARGE', '$890.00'],
      ['DISCOUNT', ''],
      ['PAYMENT', '$1,000.00'],
      ['REFUND OF OVERPAYMENT', '&minus;$110.00'],
      ['BALANCE DUE', '$0.00'],
    ]);
  });

  it('a partial payment reports what the family kept paid, after refunds', () => {
    const html = renderReceiptOfPaymentHtml(
      model({ status: 'partial_payment', paidInFullDateDisplay: null, paymentCents: 50_000, refundCents: 10_000, balanceDueCents: 49_000,
        refunds: [{ methodLabel: 'Cash', paidAtDisplay: null, amountCents: 10_000, reducedCharges: false }] }),
    );
    expect(html).toContain('PARTIAL PAYMENT:&nbsp; $400.00');
  });
});
