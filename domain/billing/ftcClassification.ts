import type { ServiceCatalogItem } from '../../types/serviceCatalog';
import type { MerchandiseProduct } from '../../types/merchandiseProduct';
import { FTC_CLASS, isFtcClass, type FtcClass } from './ftcComplianceRegistry';

/**
 * Phase 39 (Family Billing & FTC Compliance). Maps catalog/merchandise items
 * to their machine-readable FTC classification (D3). Precedence:
 *   1. an explicit, VALID `ftcClass` override on the item wins;
 *   2. otherwise the default derived from the item's `category`;
 *   3. otherwise `unclassified` — NEVER a silently-fabricated compliance
 *      meaning (an unknown/ambiguous category is surfaced as unclassified so
 *      the renderer can flag it, not fold it into a mandated bucket).
 *
 * Classification drives ONLY compliance-document rendering. It never affects
 * pricing, the GL, or AR.
 */

/** Default FTC class for a service-catalog `category` (open string). The three
    categories the pricing engine interprets map as follows; anything else is
    left unclassified (explicit, flagged). D10: the direct-cremation `base`
    line is the basic-services-fee-bearing line for Manor's bundled model. */
const SERVICE_CATEGORY_DEFAULTS: Record<string, FtcClass> = {
  base: FTC_CLASS.BASIC_SERVICES_FEE,
  weight_surcharge: FTC_CLASS.GOODS_AND_SERVICES,
  addon: FTC_CLASS.GOODS_AND_SERVICES,
  cash_advance: FTC_CLASS.CASH_ADVANCE,
};

export function serviceCategoryDefaultFtcClass(category: string): FtcClass {
  return SERVICE_CATEGORY_DEFAULTS[category] ?? FTC_CLASS.UNCLASSIFIED;
}

/** Classify a service-catalog item: valid override → category default →
    unclassified. */
export function classifyServiceItem(item: Pick<ServiceCatalogItem, 'category' | 'ftcClass'>): FtcClass {
  if (isFtcClass(item.ftcClass)) return item.ftcClass;
  return serviceCategoryDefaultFtcClass(item.category);
}

/** All tangible merchandise (urns, caskets, containers, keepsakes, etc.) are
    funeral-home goods. Merchandise has no cash-advance or basic-services-fee
    semantics, so its category never changes this. */
export function classifyMerchandiseProduct(product: Pick<MerchandiseProduct, 'category'>): FtcClass {
  // All merchandise categories are funeral-home goods; `product` is accepted so
  // the signature can specialize later without a call-site change.
  void product.category;
  return FTC_CLASS.GOODS_AND_SERVICES;
}

/** True when an item's classification could not be resolved to a mandated
    bucket — the renderer must surface these distinctly rather than treat them
    as compliant goods/services. */
export function isUnclassified(ftcClass: FtcClass): boolean {
  return ftcClass === FTC_CLASS.UNCLASSIFIED;
}
