import { describe, it, expect } from 'vitest';
import { classifyServiceItem, classifyMerchandiseProduct, serviceCategoryDefaultFtcClass, isUnclassified } from './ftcClassification';
import { FTC_CLASS } from './ftcComplianceRegistry';

describe('ftcClassification', () => {
  it('derives the basic-services-fee class for the direct-cremation base line (D10)', () => {
    expect(classifyServiceItem({ category: 'base', ftcClass: null })).toBe(FTC_CLASS.BASIC_SERVICES_FEE);
  });

  it('derives goods_and_services for weight_surcharge and addon services', () => {
    expect(classifyServiceItem({ category: 'weight_surcharge', ftcClass: null })).toBe(FTC_CLASS.GOODS_AND_SERVICES);
    expect(classifyServiceItem({ category: 'addon', ftcClass: null })).toBe(FTC_CLASS.GOODS_AND_SERVICES);
  });

  it('derives cash_advance for the cash_advance category', () => {
    expect(classifyServiceItem({ category: 'cash_advance', ftcClass: null })).toBe(FTC_CLASS.CASH_ADVANCE);
  });

  it('an explicit VALID override wins over the category default', () => {
    expect(classifyServiceItem({ category: 'base', ftcClass: FTC_CLASS.GOODS_AND_SERVICES })).toBe(FTC_CLASS.GOODS_AND_SERVICES);
  });

  it('an INVALID override is ignored (falls back to category default — never fabricates meaning)', () => {
    expect(classifyServiceItem({ category: 'addon', ftcClass: 'Cash Advance' })).toBe(FTC_CLASS.GOODS_AND_SERVICES);
    expect(classifyServiceItem({ category: 'addon', ftcClass: 'totally-made-up' })).toBe(FTC_CLASS.GOODS_AND_SERVICES);
  });

  it('an unknown category with no override is explicitly unclassified, not silently compliant', () => {
    const cls = classifyServiceItem({ category: 'some_new_category', ftcClass: null });
    expect(cls).toBe(FTC_CLASS.UNCLASSIFIED);
    expect(isUnclassified(cls)).toBe(true);
  });

  it('all merchandise classifies as goods_and_services', () => {
    expect(classifyMerchandiseProduct({ category: 'urn' })).toBe(FTC_CLASS.GOODS_AND_SERVICES);
    expect(classifyMerchandiseProduct({ category: 'casket' })).toBe(FTC_CLASS.GOODS_AND_SERVICES);
  });

  it('serviceCategoryDefaultFtcClass is display-name-independent (keyed on machine category)', () => {
    expect(serviceCategoryDefaultFtcClass('base')).toBe(FTC_CLASS.BASIC_SERVICES_FEE);
    expect(serviceCategoryDefaultFtcClass('Base')).toBe(FTC_CLASS.UNCLASSIFIED); // case-sensitive machine key
  });
});
