import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BillingCard } from './BillingCard';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as billingClient from '@/lib/billingClient';
import * as caseDocumentsClient from '@/lib/caseDocumentsClient';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
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

function renderCard(organizationId: string = DEFAULT_ORGANIZATION_ID) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={organizationId}>
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

describe('BillingCard — Manors Cash Advance UI cleanup (item #11, 2026-09)', () => {
  it('1/2/3/4: a normal Manors case (no cash advance data) shows no Cash Advance UI at all — no heading, no "No cash advance items" placeholder, no entry controls', async () => {
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(MODEL);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);

    renderCard(DEFAULT_ORGANIZATION_ID);
    await screen.findByText('Statement preview');

    expect(screen.queryByText('Cash advance items')).not.toBeInTheDocument();
    expect(screen.queryByText('No cash advance items.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cash advance description')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cash advance amount (dollars)')).not.toBeInTheDocument();
  });

  it('8/9: balance/payment information and Statement generation remain fully intact for Manors despite the Cash Advance UI being hidden', async () => {
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(MODEL);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);

    renderCard(DEFAULT_ORGANIZATION_ID);

    expect(await screen.findByText('Statement Total')).toBeInTheDocument();
    expect(await screen.findByText('Account balance due')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Generate Statement PDF' })).toBeInTheDocument();
  });

  it('10: another organization retains the full Cash Advance editor unchanged', async () => {
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(MODEL);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);

    renderCard(SECOND_MOCK_ORGANIZATION_ID);

    expect(await screen.findByText('Cash advance items')).toBeInTheDocument();
    expect(await screen.findByText('No cash advance items.')).toBeInTheDocument();
    expect(screen.getByLabelText('Cash advance description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('12/13/14: an unexpected existing Manors cash advance is neither deleted nor hidden — shown read-only, its amount stays reconciled in the FTC total, and no duplicate add/delete (Additional Items-style) controls are offered', async () => {
    const modelWithUnexpectedCashAdvance: BillingStatementModel = {
      ...MODEL,
      showCashAdvanceSection: false,
      cashAdvanceItems: [{ description: 'Third-party death certificate copy', amountCents: 5000, hasMarkup: false, isEstimated: false }],
      cashAdvanceSubtotalCents: 5000,
      ftcStatementTotalCents: 94000,
    };
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(modelWithUnexpectedCashAdvance);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([
      {
        id: 'ca-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: CASE_ID,
        description: 'Third-party death certificate copy',
        amountCents: 5000,
        hasMarkup: false,
        isEstimated: false,
        isActive: true,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);

    renderCard(DEFAULT_ORGANIZATION_ID);

    // Read-only, not concealed — the money and description are still shown.
    expect(await screen.findByText('Cash advance items on this case')).toBeInTheDocument();
    expect(screen.getByText('Third-party death certificate copy')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();

    // Never the normal editor's heading, placeholder, entry controls, or a
    // delete action — this is a read-only indication, not a resurrected
    // editor and not a second Additional Items-style entry system.
    expect(screen.queryByText('Cash advance items')).not.toBeInTheDocument();
    expect(screen.queryByText('No cash advance items.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cash advance description')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();

    // The FTC total on screen still reconciles — it includes the $50.00
    // cash advance, exactly matching the model the backend already computed.
    expect(await screen.findByText('$940.00')).toBeInTheDocument();
  });
});

describe('BillingCard — staff-facing "FTC Statement" simplified to "Statement" (2026-09)', () => {
  it('displays "Statement" (never "FTC Statement") in the card heading', async () => {
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(MODEL);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);

    renderCard();

    expect(await screen.findByText('Billing & Statement')).toBeInTheDocument();
    expect(screen.queryByText(/FTC Statement/)).not.toBeInTheDocument();
  });

  it('"Statement Total" replaces "FTC Statement total"', async () => {
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(MODEL);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);

    renderCard();

    expect(await screen.findByText('Statement Total')).toBeInTheDocument();
    expect(screen.queryByText('FTC Statement total')).not.toBeInTheDocument();
    expect(screen.queryByText('FTC Statement Total')).not.toBeInTheDocument();
  });

  it('Generate/Regenerate Statement PDF button labels remain unchanged (already staff-friendly)', async () => {
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(MODEL);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);

    renderCard();

    expect(await screen.findByRole('button', { name: 'Generate Statement PDF' })).toBeInTheDocument();
  });

  it('never renders the literal string "FTC Statement" anywhere, including in the unexpected-cash-advance read-only notice', async () => {
    const modelWithUnexpectedCashAdvance: BillingStatementModel = {
      ...MODEL,
      showCashAdvanceSection: false,
      cashAdvanceItems: [{ description: 'Third-party item', amountCents: 5000, hasMarkup: false, isEstimated: false }],
      cashAdvanceSubtotalCents: 5000,
      ftcStatementTotalCents: 94000,
    };
    vi.mocked(billingClient.fetchStatementPreview).mockResolvedValue(modelWithUnexpectedCashAdvance);
    vi.mocked(billingClient.fetchCashAdvances).mockResolvedValue([
      {
        id: 'ca-1',
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: CASE_ID,
        description: 'Third-party item',
        amountCents: 5000,
        hasMarkup: false,
        isEstimated: false,
        isActive: true,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);

    renderCard(DEFAULT_ORGANIZATION_ID);

    await screen.findByText('Cash advance items on this case');
    expect(screen.queryByText(/FTC Statement/)).not.toBeInTheDocument();
    expect(await screen.findByText(/Statement Total below/)).toBeInTheDocument();
  });
});
