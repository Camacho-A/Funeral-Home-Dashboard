import { describe, expect, it } from 'vitest';
import {
  MANORS_STATEMENT_PROVIDER_IDENTITY,
  providerIdentityFromLetterhead,
  receiptFooterFor,
  resolveStatementProviderIdentity,
  shouldShowCashAdvanceSection,
} from './organizationStatementOverrides';
import { MANORS_LOGO_DATA_URI } from './manorsLogoAsset';
import { renderStatementHtml } from './renderStatementHtml';
import { renderReceiptOfPaymentHtml } from './renderReceiptOfPaymentHtml';
import { FTC_CLASS, disclosuresFor, FTC_DISCLOSURE_VERSION } from './ftcComplianceRegistry';
import type { BillingStatementModel, ProviderIdentity } from './billingModels';
import type { ReceiptOfPaymentModel } from './receiptOfPayment';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';

/** Strings that must never appear on another organization's document. */
const MANORS_ONLY = /manors|manor's|commercial blvd|954-884-5770|305-603-9250|broward|oakland park|manorscremation/i;

/** What a funeral home's own Organization/Location record would yield —
    deliberately neutral placeholder data, not real Gus facts. */
const GUS_RECORD_IDENTITY: ProviderIdentity = {
  name: 'Gus Camacho Jr. Funeral Home',
  addressLine: '(address to be configured)',
  phone: '(555) 000-0000',
};

describe('Manors statement identity — byte-identical to the pre-profile literal', () => {
  it('matches the historical hardcoded identity exactly (same keys, same order, same values)', () => {
    const historical: ProviderIdentity = {
      name: 'MANORS CREMATION SERVICES',
      addressLine: '481 E Commercial Blvd\nOakland Park, FL 33334',
      phone: '954-884-5770',
      fax: '305-603-9250',
      email: 'contact@manorscremation.com',
      logoDataUri: MANORS_LOGO_DATA_URI,
    };
    expect(JSON.stringify(MANORS_STATEMENT_PROVIDER_IDENTITY)).toBe(JSON.stringify(historical));
  });

  it("ignores Manors' placeholder Organization/Location record (profile letterhead wins)", () => {
    const placeholderRecord: ProviderIdentity = { name: "Manor's Cremation", addressLine: '100 Memorial Drive, Springfield, IL', phone: '(555) 201-4432' };
    expect(resolveStatementProviderIdentity(MANORS_ORGANIZATION_ID, placeholderRecord)).toEqual(MANORS_STATEMENT_PROVIDER_IDENTITY);
  });

  it('keeps the Manors receipt footer and no Cash Advance section', () => {
    expect(receiptFooterFor(MANORS_ORGANIZATION_ID, 'anything')).toEqual({
      thanksLine: 'Thank you for your trust in Cremations America of Broward, LLC',
      legalEntityLine: 'DBA MANORS CREMATION',
    });
    expect(shouldShowCashAdvanceSection(MANORS_ORGANIZATION_ID)).toBe(false);
  });
});

describe('Gus Camacho Jr. — record-driven letterhead, never Manors data', () => {
  it('uses its own Organization/Location identity unchanged', () => {
    expect(resolveStatementProviderIdentity(GUS_CAMACHO_ORGANIZATION_ID, GUS_RECORD_IDENTITY)).toEqual(GUS_RECORD_IDENTITY);
  });

  it('gets a footer built from its own provider name', () => {
    expect(receiptFooterFor(GUS_CAMACHO_ORGANIZATION_ID, GUS_RECORD_IDENTITY.name)).toEqual({
      thanksLine: 'Thank you for your trust in Gus Camacho Jr. Funeral Home',
      legalEntityLine: null,
    });
  });

  it('rendered Statement HTML contains no Manors string', () => {
    const offerings = { offersDirectCremation: true, offersEmbalming: false, offersCaskets: false, offersOuterBurialContainers: false };
    const model: BillingStatementModel = {
      provider: resolveStatementProviderIdentity(GUS_CAMACHO_ORGANIZATION_ID, GUS_RECORD_IDENTITY),
      decedentName: 'Jane Doe',
      caseNumber: 'M2026-001',
      dateOfDeath: '2026-08-01',
      generatedAt: '2026-09-01',
      orderVersion: 1,
      disclosureVersion: FTC_DISCLOSURE_VERSION,
      supplementalVersion: 0,
      lineItems: [
        { ftcClass: FTC_CLASS.BASIC_SERVICES_FEE, description: 'Direct Cremation', quantity: 1, unitPriceCents: 89000, lineTotalCents: 89000, includesBasicServicesFee: true },
      ],
      basicServicesFeeMode: 'included_in_priced_service',
      goodsAndServicesTotalCents: 89000,
      paidToDateCents: 0,
      authoritativeArBalanceDueCents: 89000,
      showCashAdvanceSection: shouldShowCashAdvanceSection(GUS_CAMACHO_ORGANIZATION_ID),
      cashAdvanceItems: [],
      cashAdvanceSubtotalCents: 0,
      ftcStatementTotalCents: 89000,
      requiredPurchaseExplanations: null,
      offerings,
      disclosures: disclosuresFor('statement_of_goods_and_services', offerings),
      supplementalBlocks: [],
    };
    const html = renderStatementHtml(model);
    expect(html).toContain('Gus Camacho Jr. Funeral Home');
    expect(html).not.toMatch(MANORS_ONLY);
    expect(html).not.toContain(MANORS_LOGO_DATA_URI.slice(0, 200));
  });

  it('rendered Receipt of Payment HTML contains no Manors string', () => {
    const provider = resolveStatementProviderIdentity(GUS_CAMACHO_ORGANIZATION_ID, GUS_RECORD_IDENTITY);
    const model: ReceiptOfPaymentModel = {
      provider,
      footer: receiptFooterFor(GUS_CAMACHO_ORGANIZATION_ID, provider.name),
      statementDateDisplay: 'October 1, 2026',
      caseNumber: 'M2026-001',
      soldToName: 'SAMPLE FAMILY MEMBER',
      deceasedName: 'SAMPLE DECEDENT',
      dateOfDeathDisplay: 'September 30, 2026',
      status: 'paid_in_full',
      paidInFullDateDisplay: 'October 1, 2026',
      payments: [{ methodLabel: 'Credit Card', paidAtDisplay: 'October 1, 2026', amountCents: 89_000 }],
      lineItems: [{ quantity: 1, itemNumber: null, description: 'Direct Cremation', costCents: 89_000, discountCents: 0, totalCents: 89_000 }],
      totalChargeCents: 89_000,
      discountCents: 0,
      paymentCents: 89_000,
      balanceDueCents: 0,
      missingFields: [],
    };
    const html = renderReceiptOfPaymentHtml(model);
    expect(html).toContain('Gus Camacho Jr. Funeral Home');
    expect(html).not.toMatch(MANORS_ONLY);
  });
});

describe('unknown organization — platform defaults', () => {
  it('record identity unchanged, generic footer, Cash Advance shown', () => {
    expect(resolveStatementProviderIdentity('some-future-funeral-home', GUS_RECORD_IDENTITY)).toEqual(GUS_RECORD_IDENTITY);
    expect(receiptFooterFor('some-future-funeral-home', 'Future Home').legalEntityLine).toBeNull();
    expect(shouldShowCashAdvanceSection('some-future-funeral-home')).toBe(true);
  });
});

describe('providerIdentityFromLetterhead — field-by-field fallback for future profiles', () => {
  it('fills null letterhead fields from the record identity and omits empty optional keys', () => {
    const identity = providerIdentityFromLetterhead(
      { name: null, addressLines: null, phone: '111', fax: null, email: null, website: null, logoAssetKey: null },
      GUS_RECORD_IDENTITY,
    );
    expect(identity).toEqual({ name: GUS_RECORD_IDENTITY.name, addressLine: GUS_RECORD_IDENTITY.addressLine, phone: '111' });
    expect(Object.keys(identity)).toEqual(['name', 'addressLine', 'phone']);
  });

  it('an unknown logo key never resolves to another tenant’s logo', () => {
    const identity = providerIdentityFromLetterhead(
      { name: 'X', addressLines: ['1'], phone: '2', fax: null, email: null, website: null, logoAssetKey: 'not-registered' },
      GUS_RECORD_IDENTITY,
    );
    expect(identity.logoDataUri).toBeUndefined();
  });
});
