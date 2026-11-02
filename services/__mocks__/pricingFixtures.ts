import type { CatalogPriceChange } from '../../types/catalogPriceChange';
import type { ServiceCatalogCategory, ServiceCatalogItem } from '../../types/serviceCatalog';
import type { CaseOrder, CaseOrderLineItem } from '../../types/caseOrder';
import type { CaseOrderAuditEntry } from '../../types/caseOrderAudit';
import { DEFAULT_ORGANIZATION_ID, GUS_ORGANIZATION_ID } from './organizationIds';
import { SERVICE_CODES } from '../../domain/pricing/serviceCodes';
import { GUS_SERVICE_CATALOG, GUS_STARTER_CATALOG_CATEGORIES } from '../../domain/onboarding/gusServiceCatalog';
import { mockCollection } from './mockStore';
import { sandboxCaseOrderLineItems, sandboxCaseOrders } from './sandboxFixtures';

/**
 * Phase 19C (Service Catalog, Case Order & Pricing Engine). Mock-mode
 * fixtures — same "in-memory arrays, mutated in place by
 * services/pricingService.ts's mock branch" convention as
 * services/__mocks__/paymentFixtures.ts. `serviceCatalogFixtures` seeds
 * Manor's Cremation's real v1 price list (docs/adr/ADR-023-case-order-pricing-engine.md);
 * the three CaseOrder-related arrays start empty, same as
 * paymentRecordFixtures, since every mock-mode case/order is created fresh
 * by the test or dev session using it.
 */
const NOW = '2026-07-20T00:00:00.000Z';

export const MANORS_SERVICE_CATALOG_ID_PREFIX = `${DEFAULT_ORGANIZATION_ID}-svc`;

/** 2026-10 (Gus Camacho Jr. service catalog). Gus's mock rows are built
    straight from GUS_SERVICE_CATALOG — the same definition onboarding
    seeds live — so local mock mode can never drift from it. Every price is
    null ("price not set"); see domain/onboarding/gusServiceCatalog.ts. */
export const GUS_SERVICE_CATALOG_ID_PREFIX = `${GUS_ORGANIZATION_ID}-svc`;

export function gusServiceCatalogItemId(serviceCode: string): string {
  return `${GUS_SERVICE_CATALOG_ID_PREFIX}-${serviceCode.toLowerCase().replace(/_/g, '-')}`;
}

function buildGusServiceCatalogFixtures(): ServiceCatalogItem[] {
  return GUS_SERVICE_CATALOG.map((entry) => ({
    id: gusServiceCatalogItemId(entry.serviceCode),
    organizationId: GUS_ORGANIZATION_ID,
    serviceCode: entry.serviceCode,
    displayName: entry.displayName,
    category: entry.category,
    pricingType: entry.pricingType,
    defaultPrice: entry.defaultPrice,
    isActive: true,
    sortOrder: entry.sortOrder,
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

export const serviceCatalogFixtures: ServiceCatalogItem[] = mockCollection('serviceCatalogFixtures', (): ServiceCatalogItem[] => [
  {
    id: `${MANORS_SERVICE_CATALOG_ID_PREFIX}-direct-cremation`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    serviceCode: SERVICE_CODES.DIRECT_CREMATION,
    displayName: 'Direct Cremation',
    category: 'base',
    pricingType: 'flat',
    defaultPrice: 89_000,
    isActive: true,
    sortOrder: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${MANORS_SERVICE_CATALOG_ID_PREFIX}-weight-201-250`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    serviceCode: SERVICE_CODES.WEIGHT_SURCHARGE_201_250,
    displayName: 'Weight Surcharge (201–250 lb)',
    category: 'weight_surcharge',
    pricingType: 'flat',
    defaultPrice: 29_000,
    isActive: true,
    sortOrder: 2,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${MANORS_SERVICE_CATALOG_ID_PREFIX}-weight-251-300`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    serviceCode: SERVICE_CODES.WEIGHT_SURCHARGE_251_300,
    displayName: 'Weight Surcharge (251–300 lb)',
    category: 'weight_surcharge',
    pricingType: 'flat',
    defaultPrice: 39_000,
    isActive: true,
    sortOrder: 2,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${MANORS_SERVICE_CATALOG_ID_PREFIX}-extra-death-cert`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    serviceCode: SERVICE_CODES.EXTRA_DEATH_CERTIFICATE,
    displayName: 'Extra Death Certificate',
    category: 'addon',
    pricingType: 'per_unit',
    defaultPrice: 2_500,
    isActive: true,
    sortOrder: 3,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${MANORS_SERVICE_CATALOG_ID_PREFIX}-mail-cremated-remains`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    serviceCode: SERVICE_CODES.MAIL_CREMATED_REMAINS,
    displayName: 'Mail Cremated Remains',
    category: 'addon',
    pricingType: 'flat',
    defaultPrice: 18_500,
    isActive: true,
    sortOrder: 4,
    createdAt: NOW,
    updatedAt: NOW,
  },
  // Manors launch-prep — additional case charges.
  {
    id: `${MANORS_SERVICE_CATALOG_ID_PREFIX}-keepsake-transfer`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    serviceCode: SERVICE_CODES.KEEPSAKE_TRANSFER,
    displayName: 'Keepsake Transfer',
    category: 'addon',
    pricingType: 'per_unit',
    defaultPrice: 1_000,
    isActive: true,
    sortOrder: 5,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${MANORS_SERVICE_CATALOG_ID_PREFIX}-urn-transfer`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    serviceCode: SERVICE_CODES.URN_TRANSFER,
    displayName: 'Urn Transfer',
    category: 'addon',
    pricingType: 'flat',
    defaultPrice: 3_500,
    isActive: true,
    sortOrder: 6,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: `${MANORS_SERVICE_CATALOG_ID_PREFIX}-shipping`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    serviceCode: SERVICE_CODES.SHIPPING,
    displayName: 'Shipping',
    category: 'addon',
    pricingType: 'flat',
    defaultPrice: 18_500,
    isActive: true,
    sortOrder: 7,
    createdAt: NOW,
    updatedAt: NOW,
  },
  ...buildGusServiceCatalogFixtures(),
]);

export const caseOrderFixtures: CaseOrder[] = mockCollection('caseOrderFixtures', (): CaseOrder[] => sandboxCaseOrders());
export const caseOrderLineItemFixtures: CaseOrderLineItem[] = mockCollection('caseOrderLineItemFixtures', (): CaseOrderLineItem[] => sandboxCaseOrderLineItems());
export const caseOrderAuditFixtures: CaseOrderAuditEntry[] = mockCollection('caseOrderAuditFixtures', (): CaseOrderAuditEntry[] => []);

/** Gus Phase 5C-3 (administrator-managed price catalog). Gus's starting
    Settings › Price Catalog categories (GUS_STARTER_CATALOG_CATEGORIES) —
    names only; no item is filed under one. Manors has none. */
export function gusCatalogCategoryId(name: string): string {
  return `${GUS_ORGANIZATION_ID}-cat-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

export const serviceCatalogCategoryFixtures: ServiceCatalogCategory[] = mockCollection('serviceCatalogCategoryFixtures', (): ServiceCatalogCategory[] =>
  GUS_STARTER_CATALOG_CATEGORIES.map((name, index) => ({
    id: gusCatalogCategoryId(name),
    organizationId: GUS_ORGANIZATION_ID,
    name,
    sortOrder: (index + 1) * 10,
    isActive: true,
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
  })),
);

/** Price catalog (2026-11). The append-only price history (mock storage of
    the proposed `catalogPriceChanges` collection). Starts empty: no price
    was ever invented, so there is no history to show. */
export const catalogPriceChangeFixtures: CatalogPriceChange[] = mockCollection('catalogPriceChangeFixtures', (): CatalogPriceChange[] => []);
