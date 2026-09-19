/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). The five
 * service codes Manor's Cremation's catalog is seeded with — referenced
 * here only so calculateOrder.ts knows which catalog rows play which
 * *role* in the pricing calculation (which one is the always-included
 * base service, which two are the mutually-exclusive weight-surcharge
 * tiers, which is quantity-driven). This is the one place those specific
 * strings appear outside of the seed fixture/live-Wix seed data — never
 * inside a React component (see components/case/ServicesAndChargesSelector.tsx,
 * which renders purely from whatever category/serviceCode combination the
 * fetched catalog actually contains).
 *
 * A future organization with an entirely different catalog (no weight
 * surcharge concept at all, or five unrelated services) is unaffected:
 * calculateOrder.ts's weight-tier/death-certificate/mail-remains handling
 * below simply finds nothing to match and produces no line item for it —
 * see each lookup's own null-check.
 */
export const SERVICE_CODES = {
  DIRECT_CREMATION: 'DIRECT_CREMATION',
  WEIGHT_SURCHARGE_201_250: 'WEIGHT_SURCHARGE_201_250',
  WEIGHT_SURCHARGE_251_300: 'WEIGHT_SURCHARGE_251_300',
  EXTRA_DEATH_CERTIFICATE: 'EXTRA_DEATH_CERTIFICATE',
  MAIL_CREMATED_REMAINS: 'MAIL_CREMATED_REMAINS',
  /** Manors launch-prep — additional case charges. Quantity-based addon,
      same role as EXTRA_DEATH_CERTIFICATE ($10/unit for Manor). */
  KEEPSAKE_TRANSFER: 'KEEPSAKE_TRANSFER',
  /** Manors launch-prep. Flat, opt-in addon, same role as
      MAIL_CREMATED_REMAINS ($35 flat for Manor). */
  URN_TRANSFER: 'URN_TRANSFER',
  /** Manors launch-prep. Flat, opt-in addon ($185 flat for Manor) —
      distinct from MAIL_CREMATED_REMAINS, a different operational charge. */
  SHIPPING: 'SHIPPING',
} as const;
