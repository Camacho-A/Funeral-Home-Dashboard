import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRenderHtmlToPdf = vi.fn();
const mockUploadFile = vi.fn();
vi.mock('../lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: (...a: unknown[]) => mockRenderHtmlToPdf(...a) },
}));
vi.mock('../lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: { uploadFile: (...a: unknown[]) => mockUploadFile(...a), downloadFile: vi.fn(), deleteFile: vi.fn() },
}));

const { generateStatement, previewStatementModel, generateGeneralPriceList, BillingDocumentServiceError } = await import('./billingDocumentService');
const { createCaseOrder } = await import('./pricingService');
const { createCashAdvanceItem } = await import('./cashAdvanceService');
const { caseDocumentFixtures } = await import('./__mocks__/documentFixtures');
const { caseOrderFixtures, caseOrderLineItemFixtures } = await import('./__mocks__/pricingFixtures');
const { caseCashAdvanceItemFixtures, orgDocumentFixtures } = await import('./__mocks__/billingFixtures');
const { DEFAULT_ORGANIZATION_ID } = await import('./__mocks__/organizationIds');

const CASE = '1042';
const ctx = { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: 'staff-1', actorMembershipId: null, actorRoleKey: null, correlationId: 'corr-1' };
let n = 0;
const idFactory = () => `bill-${(n += 1)}`;

beforeEach(() => {
  n = 0;
  mockRenderHtmlToPdf.mockResolvedValue(Buffer.from('%PDF'));
  mockUploadFile.mockImplementation(async (key: string) => ({ storageKey: key }));
});
afterEach(() => {
  caseDocumentFixtures.length = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseCashAdvanceItemFixtures.length = 0;
  orgDocumentFixtures.length = 0;
  vi.clearAllMocks();
});

async function seedOrder() {
  await createCaseOrder(
    {
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: CASE,
      selections: { services: { weightTier: 'under_200', extraDeathCertificateQuantity: 0, mailCremated: false }, merchandise: [] },
      performedBy: 'staff-1',
      idFactory,
    },
    'mock',
  );
}

describe('billingDocumentService.generateStatement', () => {
  it('throws if the case has no active order', async () => {
    await expect(generateStatement({ caseId: CASE, idFactory }, ctx, 'mock')).rejects.toBeInstanceOf(BillingDocumentServiceError);
  });

  it('produces a Statement CaseDocument whose model keeps authoritative figures correct (no cash advances)', async () => {
    await seedOrder(); // Direct Cremation $890 (base → basic services fee)

    const { document, model } = await generateStatement({ caseId: CASE, idFactory }, ctx, 'mock');

    expect(document.documentTypeKey).toBe('financial.statement_goods_services');
    expect(document.status).toBe('active');
    // The direct-cremation base line is the basic-services-fee-bearing line (D10).
    const baseLine = model.lineItems.find((l) => l.includesBasicServicesFee);
    expect(baseLine).toBeTruthy();
    expect(model.basicServicesFeeMode).toBe('included_in_priced_service');
    // Authoritative accounting figures (from the order) — cash advances excluded.
    expect(model.goodsAndServicesTotalCents).toBe(89000);
    expect(model.authoritativeArBalanceDueCents).toBe(89000);
    expect(model.ftcStatementTotalCents).toBe(89000);
  });

  /**
   * Item #2 (2026-09). DEFAULT_ORGANIZATION_ID is the real Manor's Cremation
   * production organization id, which per this item's requirements does not
   * use cash advances and has its rendered Statement's Cash Advance section
   * suppressed (see domain/billing/organizationStatementOverrides.ts) —
   * generateStatement() now correctly refuses to render a Statement for
   * this organization if a cash advance item unexpectedly exists (see
   * renderStatementHtml.test.ts's "stops rather than silently hiding real
   * data" test). The FTC-total/AR-balance-distinction math these two tests
   * exist to prove is unaffected by that presentation rule — verified here
   * via previewStatementModel(), which builds the same model WITHOUT
   * rendering, so it remains a valid, org-agnostic way to exercise it.
   */
  it('keeps the FTC total and AR balance distinct when cash advances exist on the underlying order (model-only, no render)', async () => {
    await seedOrder(); // Direct Cremation $890 (base → basic services fee)
    await createCashAdvanceItem(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE, description: 'Death certificates', amountCents: 12500, hasMarkup: false, isEstimated: true, idFactory },
      'mock',
    );

    const model = await previewStatementModel(CASE, ctx, 'mock');

    // Authoritative accounting figures (from the order) — cash advances excluded.
    expect(model.goodsAndServicesTotalCents).toBe(89000);
    expect(model.authoritativeArBalanceDueCents).toBe(89000);
    // FTC total = order total + cash advances (display only).
    expect(model.cashAdvanceSubtotalCents).toBe(12500);
    expect(model.ftcStatementTotalCents).toBe(101500);
    // The estimate flag survives into the model.
    expect(model.cashAdvanceItems[0].isEstimated).toBe(true);
  });

  it('cash advances never alter the authoritative order balance', async () => {
    await seedOrder();
    const before = caseOrderFixtures.find((o) => o.caseId === CASE)!.balanceDue;
    await createCashAdvanceItem(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId: CASE, description: 'Obituary', amountCents: 30000, hasMarkup: true, isEstimated: false, idFactory },
      'mock',
    );
    await previewStatementModel(CASE, ctx, 'mock');
    const after = caseOrderFixtures.find((o) => o.caseId === CASE)!.balanceDue;
    expect(after).toBe(before); // AR untouched by cash advances
  });
});

describe('billingDocumentService.generateGeneralPriceList', () => {
  it('produces an OrgDocument GPL from the live catalog with provenance', async () => {
    const { orgDocument, model } = await generateGeneralPriceList({ effectiveDate: '2026-09-01', idFactory }, ctx, 'mock');
    expect(orgDocument.documentTypeKey).toBe('pricelist.general');
    expect(orgDocument.status).toBe('active');
    expect(orgDocument.effectiveDate).toBe('2026-09-01');
    expect(orgDocument.disclosureVersion).toMatch(/^ftc-/);
    expect(orgDocument.catalogSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    // GPL reflects the org's actual configured direct-cremation offering.
    expect(model.serviceLines.some((s) => s.category === 'base')).toBe(true);
    expect(model.offerings.offersDirectCremation).toBe(true);
    expect(model.offerings.offersCaskets).toBe(false);
  });
});
