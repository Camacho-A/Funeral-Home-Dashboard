import { describe, it, expect } from 'vitest';
import {
  FTC_CLASS,
  FTC_DISCLOSURE_VERSION,
  FTC_MANDATORY_DISCLOSURES,
  FTC_REQUIRED_SECTIONS,
  isFtcClass,
  disclosuresFor,
  type ProviderOfferings,
} from './ftcComplianceRegistry';

const DIRECT_CREMATION_ONLY: ProviderOfferings = {
  offersDirectCremation: true,
  offersEmbalming: false,
  offersCaskets: false,
  offersOuterBurialContainers: false,
};
const FULL_SERVICE: ProviderOfferings = {
  offersDirectCremation: true,
  offersEmbalming: true,
  offersCaskets: true,
  offersOuterBurialContainers: true,
};

describe('ftcComplianceRegistry', () => {
  it('exposes a stable, versioned disclosure identifier', () => {
    expect(FTC_DISCLOSURE_VERSION).toMatch(/^ftc-/);
  });

  it('isFtcClass accepts the four machine keys and rejects display-y strings', () => {
    expect(isFtcClass(FTC_CLASS.BASIC_SERVICES_FEE)).toBe(true);
    expect(isFtcClass(FTC_CLASS.CASH_ADVANCE)).toBe(true);
    expect(isFtcClass(FTC_CLASS.UNCLASSIFIED)).toBe(true);
    expect(isFtcClass('Basic Services Fee')).toBe(false);
    expect(isFtcClass('cremation')).toBe(false);
    expect(isFtcClass(null)).toBe(false);
  });

  it('every mandatory disclosure carries a citation and non-empty text (provenance)', () => {
    for (const d of FTC_MANDATORY_DISCLOSURES) {
      expect(d.citation).toMatch(/16 CFR 453/);
      expect(d.text.length).toBeGreaterThan(20);
    }
  });

  it('a direct-cremation-only provider renders the direct-cremation + itemization disclosures but NOT casket/embalming/OBC', () => {
    const gpl = disclosuresFor('general_price_list', DIRECT_CREMATION_ONLY).map((d) => d.key);
    expect(gpl).toContain('gpl.itemization_right');
    expect(gpl).toContain('gpl.direct_cremation_alternative_container');
    // must NOT imply offerings the provider does not have
    expect(gpl).not.toContain('gpl.casket_price_list');
    expect(gpl).not.toContain('gpl.outer_burial_container_price_list');
    expect(gpl).not.toContain('gpl.embalming');
  });

  it('a full-service provider renders casket/OBC/embalming disclosures too', () => {
    const gpl = disclosuresFor('general_price_list', FULL_SERVICE).map((d) => d.key);
    expect(gpl).toContain('gpl.casket_price_list');
    expect(gpl).toContain('gpl.outer_burial_container_price_list');
    expect(gpl).toContain('gpl.embalming');
  });

  it('the statement always carries the required-purchase + cash-advance-markup disclosures', () => {
    const stmt = disclosuresFor('statement_of_goods_and_services', DIRECT_CREMATION_ONLY).map((d) => d.key);
    expect(stmt).toContain('statement.required_purchase_explanation');
    expect(stmt).toContain('statement.cash_advance_markup');
    expect(stmt).not.toContain('statement.embalming'); // not offered
  });

  it('defines the required structural sections for both documents', () => {
    expect(FTC_REQUIRED_SECTIONS.general_price_list).toContain('mandatory_disclosures');
    expect(FTC_REQUIRED_SECTIONS.statement_of_goods_and_services).toContain('cash_advance_items');
    expect(FTC_REQUIRED_SECTIONS.statement_of_goods_and_services).toContain('total_of_arrangements');
  });
});
