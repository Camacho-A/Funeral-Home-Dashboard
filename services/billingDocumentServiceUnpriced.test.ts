import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10 (Gus Camacho Jr. service catalog). The FTC General Price List
 * never shows an unpriced service (`defaultPrice: null`) — not as $0.00,
 * not as a placeholder. Only rows with a real price are listed.
 */
vi.mock('../lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: vi.fn(async () => Buffer.from('%PDF')) },
}));
vi.mock('../lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: { uploadFile: vi.fn(async (key: string) => ({ storageKey: key })), downloadFile: vi.fn(), deleteFile: vi.fn() },
}));

const { generateGeneralPriceList } = await import('./billingDocumentService');
const { serviceCatalogFixtures, gusServiceCatalogItemId } = await import('./__mocks__/pricingFixtures');
const { orgDocumentFixtures } = await import('./__mocks__/billingFixtures');
const { GUS_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');

const ctx = { organizationId: GUS_ORGANIZATION_ID, actorIdentityId: 'identity-gus-admin', actorMembershipId: null, actorRoleKey: 'administrator', correlationId: 'corr-1' };
let n = 0;
const idFactory = () => `gpl-${(n += 1)}`;
let snapshot: typeof serviceCatalogFixtures;

beforeEach(() => {
  snapshot = serviceCatalogFixtures.map((i) => ({ ...i }));
});
afterEach(() => {
  serviceCatalogFixtures.length = 0;
  serviceCatalogFixtures.push(...snapshot);
  orgDocumentFixtures.length = 0;
});

describe('generateGeneralPriceList — unpriced services', () => {
  it('lists only the priced service and never a $0 line for the unpriced ones', async () => {
    const index = serviceCatalogFixtures.findIndex((i) => i.id === gusServiceCatalogItemId('CREMATION_WITH_VIEWING'));
    serviceCatalogFixtures[index] = { ...serviceCatalogFixtures[index], defaultPrice: 495_000 };

    const { model } = await generateGeneralPriceList({ effectiveDate: '2026-10-15', idFactory }, ctx, 'mock');
    expect(model.serviceLines.map((l) => [l.displayName, l.priceCents])).toEqual([['Cremation with Viewing', 495_000]]);
  });
});
