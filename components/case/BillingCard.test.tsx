import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BillingCard } from './BillingCard';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as billingClient from '@/lib/billingClient';
import * as caseDocumentsClient from '@/lib/caseDocumentsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { BillingStatementModel } from '@/domain/billing/billingModels';
import type { CaseDocument } from '@/types/caseDocument';

vi.mock('@/lib/billingClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billingClient')>('@/lib/billingClient');
  return { ...actual, fetchStatementPreview: vi.fn(), generateStatement: vi.fn(), fetchCashAdvances: vi.fn() };
});

vi.mock('@/lib/caseDocumentsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/caseDocumentsClient')>('@/lib/caseDocumentsClient');
  return { ...actual, fetchCaseDocuments: vi.fn() };
});

const CASE_ID = 'case-1';

const MODEL: BillingStatementModel = {
  provider: { name: "Manor's Cremation", addressLine: '', phone: '' },
  decedentName: 'Robert Ellison',
  caseNumber: 'B2026-001',
  dateOfDeath: '2026-07-09',
  generatedAt: '2026-09-27',
  orderVersion: 1,
  disclosureVersion: 'ftc-funeral-rule-2024-09-16',
  supplementalVersion: 0,
  lineItems: [{ ftcClass: 'basic_services_fee', description: 'Direct Cremation', quantity: 1, unitPriceCents: 89000, lineTotalCents: 89000, includesBasicServicesFee: true }],
  basicServicesFeeMode: 'included_in_priced_service',
  goodsAndServicesTotalCents: 89000,
  paidToDateCents: 0,
  authoritativeArBalanceDueCents: 89000,
  showCashAdvanceSection: true,
  cashAdvanceItems: [],
  cashAdvanceSubtotalCents: 0,
  ftcStatementTotalCents: 89000,
  requiredPurchaseExplanations: null,
  offerings: { offersDirectCremation: true, offersEmbalming: false, offersCaskets: false, offersOuterBurialContainers: false },
  disclosures: [],
  supplementalBlocks: [],
};

function makeDocument(overrides: Partial<CaseDocument> = {}): CaseDocument {
  return {
    id: 'doc-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: CASE_ID,
    origin: 'generated',
    documentTypeKey: 'financial.statement_goods_services',
    category: 'statement',
    fileName: 'Statement of Funeral Goods and Services Selected.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1234,
    checksumSha256: 'abc',
    storageKey: 'key',
    status: 'active',
    templateId: null,
    templateVersion: null,
    version: 1,
    supersedesId: null,
    signatureStatus: null,
    familyVisible: false,
    generatedBy: 'staff-1',
    uploadedBy: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <BillingCard caseId={CASE_ID} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('BillingCard — Statement generation (item #1, 2026-09)', () => {
  it('7: no existing active Statement — Generate calls generateStatement with existingDocumentId omitted', async () => {
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(MODEL);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);
    vi.mocked(billingClient.generateStatement).mockResolvedValue(makeDocument());

    renderCard();
    const button = await screen.findByRole('button', { name: 'Generate Statement PDF' });
    fireEvent.click(button);

    await waitFor(() => expect(billingClient.generateStatement).toHaveBeenCalledTimes(1));
    const call = vi.mocked(billingClient.generateStatement).mock.calls[0][0];
    expect(call.existingDocumentId).toBeUndefined();
  });

  it('8: an existing active Statement — Regenerate calls generateStatement with its id as existingDocumentId', async () => {
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(MODEL);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-active-1', status: 'active' })]);
    vi.mocked(billingClient.generateStatement).mockResolvedValue(makeDocument({ id: 'doc-active-2', supersedesId: 'doc-active-1' }));

    renderCard();
    const button = await screen.findByRole('button', { name: 'Regenerate Statement PDF' });
    fireEvent.click(button);

    await waitFor(() => expect(billingClient.generateStatement).toHaveBeenCalledTimes(1));
    const call = vi.mocked(billingClient.generateStatement).mock.calls[0][0];
    expect(call.existingDocumentId).toBe('doc-active-1');
  });

  it('9/10: only an ACTIVE Statement is eligible — failed/archived/superseded Statements are not selected as existingDocumentId', async () => {
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(MODEL);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-failed', status: 'failed' }),
      makeDocument({ id: 'doc-archived', status: 'archived' }),
      makeDocument({ id: 'doc-superseded', status: 'superseded' }),
    ]);
    vi.mocked(billingClient.generateStatement).mockResolvedValue(makeDocument({ id: 'doc-new' }));

    renderCard();
    // No active Statement among failed/archived/superseded rows — button
    // stays the initial "Generate", not "Regenerate".
    const button = await screen.findByRole('button', { name: 'Generate Statement PDF' });
    fireEvent.click(button);

    await waitFor(() => expect(billingClient.generateStatement).toHaveBeenCalledTimes(1));
    const call = vi.mocked(billingClient.generateStatement).mock.calls[0][0];
    expect(call.existingDocumentId).toBeUndefined();
  });

  it('11: an unrelated active document type (not a Statement) is never selected as existingDocumentId', async () => {
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(MODEL);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-cremation-auth', documentTypeKey: 'authorization.cremation', status: 'active' }),
    ]);
    vi.mocked(billingClient.generateStatement).mockResolvedValue(makeDocument({ id: 'doc-new' }));

    renderCard();
    const button = await screen.findByRole('button', { name: 'Generate Statement PDF' });
    fireEvent.click(button);

    await waitFor(() => expect(billingClient.generateStatement).toHaveBeenCalledTimes(1));
    const call = vi.mocked(billingClient.generateStatement).mock.calls[0][0];
    expect(call.existingDocumentId).toBeUndefined();
  });
});
