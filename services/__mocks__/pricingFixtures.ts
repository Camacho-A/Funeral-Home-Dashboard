import type { ServiceCatalogItem } from '../../types/serviceCatalog';
import type { CaseOrder, CaseOrderLineItem } from '../../types/caseOrder';
import type { CaseOrderAuditEntry } from '../../types/caseOrderAudit';
import { DEFAULT_ORGANIZATION_ID } from './organizationIds';
import { SERVICE_CODES } from '../../domain/pricing/serviceCodes';

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

export const serviceCatalogFixtures: ServiceCatalogItem[] = [
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
];

export const caseOrderFixtures: CaseOrder[] = [];
export const caseOrderLineItemFixtures: CaseOrderLineItem[] = [];
export const caseOrderAuditFixtures: CaseOrderAuditEntry[] = [];
