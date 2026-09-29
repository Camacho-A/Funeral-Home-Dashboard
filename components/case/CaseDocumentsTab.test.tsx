import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseDocumentsTab } from './CaseDocumentsTab';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as caseDocumentsClient from '@/lib/caseDocumentsClient';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { organizationsService } from '@/services/organizationsService';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { CaseDocument } from '@/types/caseDocument';
import type { Organization } from '@/types/organization';

vi.mock('@/lib/caseDocumentsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/caseDocumentsClient')>('@/lib/caseDocumentsClient');
  return { ...actual, fetchCaseDocuments: vi.fn(), archiveCaseDocument: vi.fn(), fetchBulkDownloadZip: vi.fn(), fetchBulkPrintPdf: vi.fn(), generateCaseDocument: vi.fn() };
});

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

// Handwritten item #4 (2026-09): CaseDocumentsTab now also reads
// useOrganizationRecord() to resolve the Signature Requests capability —
// mocked here so every test resolves deterministically instead of
// attempting a real fetch. Defaults to the real Manors organization id
// (matching renderTab()'s own default organizationId), which the
// Signature Requests capability override always resolves to disabled —
// harmless for every pre-existing test below, none of which asserts on
// Request Signature/signature-related UI.
vi.mock('@/services/organizationsService', async () => {
  const actual = await vi.importActual<typeof import('@/services/organizationsService')>('@/services/organizationsService');
  const mockGet = vi.fn();
  // useOrganizationRecord() calls the `organizationsService` namespace
  // object's own `.get` method, not the standalone `get` export — both
  // must point at the same mock function for the hook to actually see it.
  return { ...actual, get: mockGet, organizationsService: { ...actual.organizationsService, get: mockGet } };
});

const mockPrintStoredDocument = vi.fn();
const mockPrintFile = vi.fn();
vi.mock('@/utils/print', () => ({
  printStoredDocument: (...args: unknown[]) => mockPrintStoredDocument(...args),
  printFile: (...args: unknown[]) => mockPrintFile(...args),
}));

// Both dialogs read the org-wide template list on mount even before the
// user opens them (GenerateDocumentDialog's own useDocumentTemplates call),
// so it's stubbed empty here to keep this file focused on the tab itself.
vi.mock('@/lib/documentTemplatesClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/documentTemplatesClient')>('@/lib/documentTemplatesClient');
  return { ...actual, fetchDocumentTemplates: vi.fn().mockResolvedValue([]) };
});

function makeDocument(overrides: Partial<CaseDocument> = {}): CaseDocument {
  return {
    id: 'doc-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    origin: 'generated',
    documentTypeKey: 'authorization.cremation',
    category: 'authorization',
    fileName: 'Cremation Authorization.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 12345,
    checksumSha256: 'abc123',
    storageKey: 'managed-cremations/case-1/doc-1.pdf',
    status: 'active',
    templateId: 'template-1',
    templateVersion: 1,
    version: 1,
    supersedesId: null,
    signatureStatus: null,
    familyVisible: false,
    generatedBy: 'Dana',
    uploadedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function renderTab(organizationId: string = DEFAULT_ORGANIZATION_ID) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={organizationId}>
        <CaseDocumentsTab caseId="case-1" caseName="Jane Doe" caseNumber="B2026-001" />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

function mockPermissions(permissions: string[], roleKey: string = 'administrator') {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey, permissions });
}

function mockOrganization(overrides: Partial<Organization> & { id: string }) {
  vi.mocked(organizationsService.get).mockResolvedValue({ name: 'Test Org', isActive: true, ...overrides });
}

beforeEach(() => {
  mockPermissions(['document.view', 'document.generate', 'document.upload', 'document.archive', 'signature.request', 'signature.read', 'signature.cancel']);
  mockOrganization({ id: DEFAULT_ORGANIZATION_ID });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('CaseDocumentsTab — loading and error states', () => {
  it('shows a loading indicator while the document list is pending', () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockImplementation(() => new Promise(() => {}));
    renderTab();
    expect(screen.getByText('Loading documents…')).toBeInTheDocument();
  });

  it('shows an error message when the document list fails to load', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockRejectedValue(new Error('network error'));
    renderTab();
    expect(await screen.findByText(/Couldn.t load documents\. Please try again\./)).toBeInTheDocument();
  });

  it('shows an empty state when the case has no documents', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('No documents for this case yet.')).toBeInTheDocument();
  });
});

describe('CaseDocumentsTab — permission graceful degradation (AUTH_ADAPTER=mock)', () => {
  it('still renders the document list and every action button when GET /api/rbac/my-permissions is unavailable (e.g. mock auth mode) rather than showing "no access"', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    vi.mocked(identityAuthClient.fetchMyPermissions).mockRejectedValue(new Error('401'));
    renderTab();

    expect(await screen.findByText('Cremation Authorization.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload File' })).toBeInTheDocument();
  });

  it('renders documents and action buttons immediately, before the permissions query has settled', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    vi.mocked(identityAuthClient.fetchMyPermissions).mockImplementation(() => new Promise(() => {}));
    renderTab();

    expect(await screen.findByText('Cremation Authorization.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Document' })).toBeInTheDocument();
  });
});

describe('CaseDocumentsTab — document list', () => {
  it("renders a document's type, version, origin, actor, and status badge", async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    renderTab();

    const fileName = await screen.findByText('Cremation Authorization.pdf');
    const row = fileName.closest('div')!.parentElement!;
    expect(within(row).getByText(/Cremation Authorization.*v1.*Generated by Dana/)).toBeInTheDocument();
    expect(within(row).getByText('Generated')).toBeInTheDocument();
  });

  it('labels an uploaded document as "Uploaded file" with its uploader, not a template type', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ origin: 'uploaded', documentTypeKey: null, category: null, templateId: null, templateVersion: null, version: null, generatedBy: null, uploadedBy: 'Chris', fileName: 'photo-id.pdf' }),
    ]);
    renderTab();

    expect(await screen.findByText('photo-id.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Uploaded file/)).toBeInTheDocument();
    expect(screen.getByText(/Uploaded by Chris/)).toBeInTheDocument();
  });

  it('shows a Download link only for active/superseded/archived statuses, not pending or failed', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-pending', fileName: 'pending.pdf', status: 'pending' }),
      makeDocument({ id: 'doc-active', fileName: 'active.pdf', status: 'active' }),
      makeDocument({ id: 'doc-failed', fileName: 'failed.pdf', status: 'failed' }),
    ]);
    renderTab();

    await screen.findByText('active.pdf');
    expect(screen.getAllByText('Download')).toHaveLength(1);
  });

  it('shows a Regenerate button only for an active, generated document, not an uploaded or superseded one', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-active', fileName: 'active.pdf', status: 'active' }),
      makeDocument({ id: 'doc-superseded', fileName: 'superseded.pdf', status: 'superseded' }),
      makeDocument({ id: 'doc-uploaded', fileName: 'uploaded.pdf', origin: 'uploaded', status: 'active' }),
    ]);
    renderTab();

    await screen.findByText('active.pdf');
    expect(screen.getAllByText('Regenerate')).toHaveLength(1);
  });

  it('hides Generate/Upload/Archive controls for a role without the matching permission', async () => {
    mockPermissions(['document.view']);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    renderTab();

    await screen.findByText('Cremation Authorization.pdf');
    expect(screen.queryByRole('button', { name: 'Generate Document' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload File' })).not.toBeInTheDocument();
    expect(screen.queryByText('Archive')).not.toBeInTheDocument();
  });
});

describe('CaseDocumentsTab — archive flow', () => {
  it('archives a document after confirming, for an organization with archiving enabled (not Manors — item #12, 2026-09)', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    vi.mocked(caseDocumentsClient.archiveCaseDocument).mockResolvedValue(undefined);
    mockOrganization({ id: SECOND_MOCK_ORGANIZATION_ID });
    renderTab(SECOND_MOCK_ORGANIZATION_ID);

    await screen.findByText('Cremation Authorization.pdf');
    fireEvent.click(screen.getByText('Archive'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Cremation Authorization.pdf');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(caseDocumentsClient.archiveCaseDocument).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: SECOND_MOCK_ORGANIZATION_ID, caseId: 'case-1', documentId: 'doc-1' }),
      ),
    );
  });

  it('opens the Generate Document dialog when "Generate Document" is clicked', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);
    renderTab();

    await screen.findByText('No documents for this case yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Generate Document' }));

    expect(await screen.findByRole('dialog', { name: 'Generate Document' })).toBeInTheDocument();
  });
});

describe('item #2 — Documents tab Print (replaces the removed Overview DocumentsCard print)', () => {
  it('12: offers a Print action for a downloadable document, using the real authorized download route — never a synthetic placeholder', async () => {
    mockPrintStoredDocument.mockResolvedValue(undefined);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Cremation Authorization.pdf' })]);
    renderTab();

    await screen.findByText('Cremation Authorization.pdf');
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(mockPrintStoredDocument).toHaveBeenCalledTimes(1));
  });

  it('passes the same authorized download URL the Download link itself uses, plus the file/case identity', async () => {
    mockPrintStoredDocument.mockResolvedValue(undefined);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Cremation Authorization.pdf' })]);
    renderTab();

    await screen.findByText('Cremation Authorization.pdf');
    const downloadLink = screen.getByRole('link', { name: 'Download' }) as HTMLAnchorElement;
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    await waitFor(() => expect(mockPrintStoredDocument).toHaveBeenCalledTimes(1));
    expect(mockPrintStoredDocument).toHaveBeenCalledWith(downloadLink.getAttribute('href'), 'Cremation Authorization.pdf', 'Jane Doe', 'B2026-001');
  });

  it("does not offer Print for a status that also lacks Download (e.g. 'pending')", async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'pending.pdf', status: 'pending' })]);
    renderTab();

    await screen.findByText('pending.pdf');
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('shows an inline error, scoped to that one document, when printing fails — never a misleading success or a placeholder page', async () => {
    mockPrintStoredDocument.mockRejectedValue(new Error("Couldn't retrieve the document to print (status 404)."));
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Cremation Authorization.pdf' })]);
    renderTab();

    await screen.findByText('Cremation Authorization.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/retrieve the document to print/);
  });

  it('13: offers a bulk "Print All" action once combined server-side PDF composition exists (Task #3, 2026-09)', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-1', fileName: 'one.pdf' }),
      makeDocument({ id: 'doc-2', fileName: 'two.pdf' }),
    ]);
    renderTab();

    await screen.findByText('one.pdf');
    expect(screen.getByRole('button', { name: /print all/i })).toBeInTheDocument();
  });
});

describe('Task #3 (2026-09) — Print All / Download All bulk case document actions', () => {
  it('1. Print All renders when eligible documents exist', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Statement.pdf' })]);
    renderTab();

    await screen.findByText('Statement.pdf');
    expect(screen.getByRole('button', { name: 'Print All' })).toBeEnabled();
  });

  it('2. Download All renders when eligible documents exist', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Statement.pdf' })]);
    renderTab();

    await screen.findByText('Statement.pdf');
    expect(screen.getByRole('button', { name: 'Download All' })).toBeEnabled();
  });

  it('3. empty state: both bulk actions are disabled when there are no documents at all', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);
    renderTab();

    await screen.findByText('No documents for this case yet.');
    expect(screen.getByRole('button', { name: 'Print All' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download All' })).toBeDisabled();
  });

  it('3b. empty state: both bulk actions are disabled when every document is pending/failed (none currently eligible)', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-1', fileName: 'still-generating.pdf', status: 'pending' }),
      makeDocument({ id: 'doc-2', fileName: 'broken.pdf', status: 'failed' }),
    ]);
    renderTab();

    await screen.findByText('still-generating.pdf');
    expect(screen.getByRole('button', { name: 'Print All' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download All' })).toBeDisabled();
  });

  it('5/6, 21 (Task #12 final follow-up, 2026-09): an archived-only document set disables Print All/Download All — bulk actions never reach into History', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Old Statement.pdf', status: 'archived' })]);
    renderTab();

    // The archived document renders under History (Task #12 follow-up) —
    // the Documents view shows its own empty state, and bulk eligibility
    // (isCaseDocumentEligibleForBulkAction, active-only) now agrees:
    // Print All/Download All are disabled, matching zero current, usable
    // documents.
    await screen.findByText('No documents for this case yet.');
    expect(screen.getByRole('button', { name: 'Print All' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download All' })).toBeDisabled();
  });

  it('22. Manors Archive action remains disabled — bulk actions do not reintroduce it', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Statement.pdf', status: 'active' })]);
    renderTab(DEFAULT_ORGANIZATION_ID); // managed-cremations — Manors, archiving disabled since item #12

    await screen.findByText('Statement.pdf');
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('7/8. Download All triggers exactly one ZIP fetch and a browser save, and surfaces no warning when nothing was excluded', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:fake-url'), revokeObjectURL: vi.fn() });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Statement.pdf' })]);
    const blob = new Blob(['fake zip bytes'], { type: 'application/zip' });
    vi.mocked(caseDocumentsClient.fetchBulkDownloadZip).mockResolvedValue({ blob, fileName: 'B2026-001-documents.zip', excluded: [] });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderTab();

    await screen.findByText('Statement.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Download All' }));

    await waitFor(() => expect(caseDocumentsClient.fetchBulkDownloadZip).toHaveBeenCalledTimes(1));
    expect(caseDocumentsClient.fetchBulkDownloadZip).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 'case-1');
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    clickSpy.mockRestore();
  });

  it('14. partial failure is clearly surfaced to staff for Download All', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:fake-url'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-1', fileName: 'Statement.pdf' }),
      makeDocument({ id: 'doc-2', fileName: 'Broken.pdf' }),
    ]);
    const blob = new Blob(['fake zip bytes'], { type: 'application/zip' });
    vi.mocked(caseDocumentsClient.fetchBulkDownloadZip).mockResolvedValue({
      blob,
      fileName: 'B2026-001-documents.zip',
      excluded: [{ fileName: 'Broken.pdf', reason: 'Document storage is currently unavailable.' }],
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderTab();

    await screen.findByText('Statement.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Download All' }));

    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent('Broken.pdf');
    expect(warning).toHaveTextContent('Document storage is currently unavailable.');
  });

  it('15. Print All fetches the combined PDF and hands it to the same printFile utility individual Print uses', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Statement.pdf' })]);
    const blob = new Blob(['fake pdf bytes'], { type: 'application/pdf' });
    vi.mocked(caseDocumentsClient.fetchBulkPrintPdf).mockResolvedValue({ blob, fileName: 'B2026-001-documents.pdf', excluded: [] });
    renderTab();

    await screen.findByText('Statement.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Print All' }));

    await waitFor(() => expect(caseDocumentsClient.fetchBulkPrintPdf).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 'case-1'));
    await waitFor(() => expect(mockPrintFile).toHaveBeenCalledWith(blob, 'All Documents', 'Jane Doe', 'B2026-001'));
  });

  it('a DOCX-type exclusion from Print All is clearly surfaced, distinct from a storage failure', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-1', fileName: 'Statement.pdf' }),
      makeDocument({ id: 'doc-2', fileName: 'Scan.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    ]);
    const blob = new Blob(['fake pdf bytes'], { type: 'application/pdf' });
    vi.mocked(caseDocumentsClient.fetchBulkPrintPdf).mockResolvedValue({
      blob,
      fileName: 'B2026-001-documents.pdf',
      excluded: [{ fileName: 'Scan.docx', reason: 'This file type cannot be included in the combined print — download it separately to print it.' }],
    });
    renderTab();

    await screen.findByText('Statement.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Print All' }));

    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent('Scan.docx');
    expect(warning).toHaveTextContent('cannot be included in the combined print');
  });

  it('surfaces a clear error, never a silent failure, when the bulk endpoint itself rejects the request', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Statement.pdf' })]);
    vi.mocked(caseDocumentsClient.fetchBulkDownloadZip).mockRejectedValue(new Error('Not authorized to view documents for this case.'));
    renderTab();

    await screen.findByText('Statement.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Download All' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Not authorized to view documents for this case.');
  });

  it('19. individual Download remains functional alongside the new bulk actions', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Statement.pdf' })]);
    renderTab();

    await screen.findByText('Statement.pdf');
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/cases/case-1/documents/doc-1/download'),
    );
  });

  it('20. individual Print remains functional alongside the new bulk actions', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-1', fileName: 'Statement.pdf' })]);
    renderTab();

    await screen.findByText('Statement.pdf');
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
  });
});

describe('CaseDocumentsTab — Signature Requests organization capability (handwritten item #4, 2026-09)', () => {
  it('1/2: Request Signature does NOT render for managed-cremations (Manors — Signature Requests disabled)', async () => {
    mockOrganization({ id: DEFAULT_ORGANIZATION_ID });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    renderTab(DEFAULT_ORGANIZATION_ID);

    await screen.findByText('Cremation Authorization.pdf');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Request Signature' })).not.toBeInTheDocument());
  });

  it('4: another organization with the capability absent (default) retains Request Signature', async () => {
    mockOrganization({ id: 'org-other-signature-test' });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ organizationId: 'org-other-signature-test' })]);
    renderTab('org-other-signature-test');

    await screen.findByText('Cremation Authorization.pdf');
    expect(await screen.findByRole('button', { name: 'Request Signature' })).toBeInTheDocument();
  });

  it('5: another organization with the capability explicitly enabled retains Request Signature', async () => {
    mockOrganization({ id: 'org-other-signature-test-2', signatureRequestsEnabled: true });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ organizationId: 'org-other-signature-test-2' })]);
    renderTab('org-other-signature-test-2');

    await screen.findByText('Cremation Authorization.pdf');
    expect(await screen.findByRole('button', { name: 'Request Signature' })).toBeInTheDocument();
  });

  it("3/12/13/14: all other Documents actions (Download, Print, Regenerate) and document viewing remain available for Manors — Archive is the one action disabled (item #12, 2026-09)", async () => {
    mockOrganization({ id: DEFAULT_ORGANIZATION_ID });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-generated', fileName: 'Statement of Funeral Goods and Services Selected.pdf', origin: 'generated' }),
    ]);
    renderTab(DEFAULT_ORGANIZATION_ID);

    await screen.findByText('Statement of Funeral Goods and Services Selected.pdf');
    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload File' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Request Signature' })).not.toBeInTheDocument());
  });

  it('no disabled/placeholder Request Signature button is left behind for Manors — the action is either fully available or fully absent', async () => {
    mockOrganization({ id: DEFAULT_ORGANIZATION_ID });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    renderTab(DEFAULT_ORGANIZATION_ID);

    await screen.findByText('Cremation Authorization.pdf');
    await waitFor(() => {
      const disabledSignatureButtons = screen.queryAllByRole('button', { name: /signature/i }).filter((btn) => (btn as HTMLButtonElement).disabled);
      expect(disabledSignatureButtons).toHaveLength(0);
    });
  });
});

describe('CaseDocumentsTab — document Archive disabled for Manors (handwritten item #12, 2026-09)', () => {
  it('1/2: Archive is NOT shown for Manors, even for an Administrator who holds document.archive', async () => {
    mockPermissions(['document.view', 'document.archive'], 'administrator');
    mockOrganization({ id: DEFAULT_ORGANIZATION_ID });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    renderTab(DEFAULT_ORGANIZATION_ID);

    await screen.findByText('Cremation Authorization.pdf');
    expect(screen.queryByText('Archive')).not.toBeInTheDocument();
  });

  it('3: a Funeral Director in Manors does NOT see Archive even though the role holds document.archive', async () => {
    mockPermissions(['document.view', 'document.archive'], 'funeralDirector');
    mockOrganization({ id: DEFAULT_ORGANIZATION_ID });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    renderTab(DEFAULT_ORGANIZATION_ID);

    await screen.findByText('Cremation Authorization.pdf');
    expect(screen.queryByText('Archive')).not.toBeInTheDocument();
  });

  it('4: a Manager in Manors does NOT see Archive even though the role holds document.archive', async () => {
    mockPermissions(['document.view', 'document.archive'], 'manager');
    mockOrganization({ id: DEFAULT_ORGANIZATION_ID });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    renderTab(DEFAULT_ORGANIZATION_ID);

    await screen.findByText('Cremation Authorization.pdf');
    expect(screen.queryByText('Archive')).not.toBeInTheDocument();
  });

  it('8: another organization retains Archive when the caller holds document.archive', async () => {
    mockPermissions(['document.view', 'document.archive'], 'administrator');
    mockOrganization({ id: SECOND_MOCK_ORGANIZATION_ID });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ organizationId: SECOND_MOCK_ORGANIZATION_ID })]);
    renderTab(SECOND_MOCK_ORGANIZATION_ID);

    await screen.findByText('Cremation Authorization.pdf');
    expect(await screen.findByText('Archive')).toBeInTheDocument();
  });

  it('9: another organization without document.archive still does not show Archive (ordinary permission gating, unaffected by the capability)', async () => {
    mockPermissions(['document.view'], 'administrator');
    mockOrganization({ id: SECOND_MOCK_ORGANIZATION_ID });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ organizationId: SECOND_MOCK_ORGANIZATION_ID })]);
    renderTab(SECOND_MOCK_ORGANIZATION_ID);

    await screen.findByText('Cremation Authorization.pdf');
    expect(screen.queryByText('Archive')).not.toBeInTheDocument();
  });

  it('6/7: an existing archived Manors document remains visible — now under History (Task #12 follow-up) — and remains downloadable/printable there; this task disables NEW archive actions only, it is not a migration', async () => {
    mockOrganization({ id: DEFAULT_ORGANIZATION_ID });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-already-archived', fileName: 'old-scan.pdf', status: 'archived' }),
    ]);
    renderTab(DEFAULT_ORGANIZATION_ID);

    // Archived documents browse under History now — not the primary
    // Documents view (see caseDocumentDisplay.ts#isCaseDocumentHistorical).
    await screen.findByText('No documents for this case yet.');
    expect(screen.queryByText('old-scan.pdf')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('old-scan.pdf')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
    // Never re-offered for archiving again (it's already archived, not active).
    expect(screen.queryByText('Archive')).not.toBeInTheDocument();
  });

  it('no disabled/placeholder Archive button is left behind for Manors — the action is either fully available or fully absent', async () => {
    mockOrganization({ id: DEFAULT_ORGANIZATION_ID });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    renderTab(DEFAULT_ORGANIZATION_ID);

    await screen.findByText('Cremation Authorization.pdf');
    await waitFor(() => {
      const disabledArchiveButtons = screen.queryAllByText('Archive').filter((el) => (el as HTMLButtonElement).disabled);
      expect(disabledArchiveButtons).toHaveLength(0);
    });
  });
});

// Task #12 (2026-09, Forms organization) — the Documents/Forms sub-tab
// switcher this tab now owns. CaseFormsSection itself is unchanged and
// exhaustively covered by its own test file; these tests only cover the
// switcher shell: default state, switching behavior, accessibility, and
// that no mutation/refetch of either surface's data is triggered merely by
// switching between them.
function mockFormsFetch(forms: unknown[]) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/forms?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ forms }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

function formRow(overrides: Record<string, unknown> = {}) {
  return {
    config: { id: 'config-vital', label: 'Vital Statistics', audience: 'family' },
    status: 'received',
    sentAt: '2026-01-01T00:00:00.000Z',
    submissionId: 'sub-vital-1',
    pdfStatus: 'stored',
    documentId: 'doc-vital-1',
    ...overrides,
  };
}

describe('CaseDocumentsTab — Documents/Forms sub-tab switcher (Task #12, 2026-09)', () => {
  it('1/2: Documents is the default sub-tab, and the top-level Case Detail Documents tab is not duplicated as a new top-level tab (this component renders only the sub-tab bar, never a second set of page-level tabs)', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    vi.stubGlobal('fetch', mockFormsFetch([formRow()]));
    renderTab();

    await screen.findByText('Cremation Authorization.pdf');
    expect(screen.getByRole('tab', { name: 'Documents' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Forms' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByText('Vital Statistics')).not.toBeInTheDocument();
  });

  it('3/4: existing case Documents remain accessible and render unchanged on the default sub-tab', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    vi.stubGlobal('fetch', mockFormsFetch([]));
    renderTab();

    expect(await screen.findByText('Cremation Authorization.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload File' })).toBeInTheDocument();
  });

  it('5/6: clicking Forms reveals existing form-status/activity information and its actions for a user who already had permission', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    vi.stubGlobal('fetch', mockFormsFetch([formRow()]));
    renderTab();

    await screen.findByText('Cremation Authorization.pdf');
    fireEvent.click(screen.getByRole('tab', { name: 'Forms' }));

    expect(await screen.findByText('Vital Statistics')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Forms' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Documents' })).toHaveAttribute('aria-selected', 'false');
    // Documents content is hidden while Forms is active, not merely styled away.
    expect(screen.queryByText('Cremation Authorization.pdf')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Document' })).not.toBeInTheDocument();
  });

  it('clicking back to Documents shows Documents content again and hides Forms', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    vi.stubGlobal('fetch', mockFormsFetch([formRow()]));
    renderTab();

    await screen.findByText('Cremation Authorization.pdf');
    fireEvent.click(screen.getByRole('tab', { name: 'Forms' }));
    await screen.findByText('Vital Statistics');

    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(await screen.findByText('Cremation Authorization.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Vital Statistics')).not.toBeInTheDocument();
  });

  it('11/12/13: switching sub-tabs triggers no document/form mutation and no PDF regeneration — the Forms side only ever re-issues its own read (GET /forms), never archive/retry/generate/link calls, and Documents is never refetched merely by switching', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    const fetchMock = mockFormsFetch([formRow()]);
    vi.stubGlobal('fetch', fetchMock);
    renderTab();

    await screen.findByText('Cremation Authorization.pdf');
    fireEvent.click(screen.getByRole('tab', { name: 'Forms' }));
    await screen.findByText('Vital Statistics');
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    await screen.findByText('Cremation Authorization.pdf');
    fireEvent.click(screen.getByRole('tab', { name: 'Forms' }));
    await screen.findByText('Vital Statistics');

    // Documents' own query client never refetches merely from switching away
    // and back — CaseDocumentsTab itself stays mounted throughout, only its
    // conditionally-rendered children change.
    expect(caseDocumentsClient.fetchCaseDocuments).toHaveBeenCalledTimes(1);
    // CaseFormsSection unmounts/remounts with the sub-tab (a plain conditional
    // render), so its own react-query re-issues its read on each remount —
    // that's an ordinary read, never a mutation, which is what matters here.
    const formsCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : (input as URL | Request).toString();
      return url.includes('/forms?');
    });
    expect(formsCalls.length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.some(([input]) => (typeof input === 'string' ? input : (input as URL | Request).toString()).includes('/retry-pdf'))).toBe(false);
    expect(caseDocumentsClient.archiveCaseDocument).not.toHaveBeenCalled();
  });

  it('the Forms tab is a sub-tab of Documents, not a second top-level tab — there is exactly one Documents tab, one Forms tab, and one History tab rendered, all inside the same tablist', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    vi.stubGlobal('fetch', mockFormsFetch([]));
    renderTab();

    await screen.findByText('Cremation Authorization.pdf');
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getAllByRole('tab', { name: 'Documents' })).toHaveLength(1);
    expect(screen.getAllByRole('tab', { name: 'Forms' })).toHaveLength(1);
    expect(screen.getAllByRole('tab', { name: 'History' })).toHaveLength(1);
  });
});

// Task #12 follow-up (2026-09, Documents/History separation) — the
// user's own 21-point test list, matched 1:1 where a point names a
// specific, checkable behavior of this component.
describe('CaseDocumentsTab — Documents/History separation (Task #12 follow-up, 2026-09)', () => {
  it('2/3: a current active document appears under Documents and does NOT appear under History', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-active', fileName: 'active-statement.pdf', status: 'active' })]);
    renderTab();

    expect(await screen.findByText('active-statement.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    await screen.findByText('No superseded or archived documents for this case yet.');
    expect(screen.queryByText('active-statement.pdf')).not.toBeInTheDocument();
  });

  it('4/5: a successful superseded document appears under History and does NOT appear under Documents', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-active', fileName: 'Statement.pdf', status: 'active', version: 9 }),
      makeDocument({ id: 'doc-superseded', fileName: 'Statement.pdf', status: 'superseded', version: 8 }),
    ]);
    renderTab();

    await screen.findByText('Statement.pdf');
    // Documents view shows exactly the active row — the superseded row's
    // own supersededId/version distinguishes it, but since both share a
    // filename, assert by count instead.
    expect(screen.getAllByText('Statement.pdf')).toHaveLength(1);
    expect(screen.getByText('v9', { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('Statement.pdf')).toBeInTheDocument();
    expect(screen.getByText('v8', { exact: false })).toBeInTheDocument();
  });

  it('6/7: multiple superseded versions all appear in History, each showing its own existing version metadata', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-newest', fileName: 'Statement-newest.pdf', status: 'active', version: 9 }),
      makeDocument({ id: 'doc-mid', fileName: 'Statement-mid.pdf', status: 'superseded', version: 8 }),
      makeDocument({ id: 'doc-oldest', fileName: 'Statement-oldest.pdf', status: 'superseded', version: 7 }),
    ]);
    renderTab();
    await screen.findByText('Statement-newest.pdf');

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('Statement-mid.pdf')).toBeInTheDocument();
    expect(screen.getByText('Statement-oldest.pdf')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent?.includes('· v8 ·') === true)).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent?.includes('· v7 ·') === true)).toBeInTheDocument();
    // The current active document never leaks into History.
    expect(screen.queryByText('Statement-newest.pdf')).not.toBeInTheDocument();
  });

  it('8: no document is duplicated between Documents and History across a mixed set', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-active', fileName: 'active-only.pdf', status: 'active' }),
      makeDocument({ id: 'doc-superseded', fileName: 'superseded-only.pdf', status: 'superseded' }),
      makeDocument({ id: 'doc-archived', fileName: 'archived-only.pdf', status: 'archived' }),
    ]);
    renderTab();

    await screen.findByText('active-only.pdf');
    expect(screen.queryByText('superseded-only.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('archived-only.pdf')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('superseded-only.pdf')).toBeInTheDocument();
    expect(screen.getByText('archived-only.pdf')).toBeInTheDocument();
    expect(screen.queryByText('active-only.pdf')).not.toBeInTheDocument();
  });

  it('10/11: Generate Document remains under Documents and is not offered under History', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-superseded', fileName: 'old.pdf', status: 'superseded' })]);
    renderTab();

    expect(await screen.findByRole('button', { name: 'Generate Document' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    await screen.findByText('old.pdf');
    expect(screen.queryByRole('button', { name: 'Generate Document' })).not.toBeInTheDocument();
  });

  it('12: an existing active uploaded document (not generated) remains in Documents', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-uploaded', fileName: 'scan.pdf', origin: 'uploaded', status: 'active', templateId: null, templateVersion: null, version: null, generatedBy: null, uploadedBy: 'Dana' }),
    ]);
    renderTab();
    expect(await screen.findByText('scan.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Uploaded by Dana/)).toBeInTheDocument();
  });

  it('13: an active document produced from an external form submission (e.g. Vital Statistics) remains in Documents like any other active CaseDocument', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-vital', fileName: 'Vital Statistics.pdf', documentTypeKey: 'vitalStatistics', status: 'active' }),
    ]);
    renderTab();
    expect(await screen.findByText('Vital Statistics.pdf')).toBeInTheDocument();
  });

  it('14: a failed record with no usable file is NOT presented under History as a historical PDF — it stays visible in Documents, distinctly badged, never downloadable', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument({ id: 'doc-failed', fileName: 'Broken.pdf', status: 'failed' })]);
    renderTab();

    expect(await screen.findByText('Broken.pdf')).toBeInTheDocument();
    expect(screen.getByText('Generation Failed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    await screen.findByText('No superseded or archived documents for this case yet.');
    expect(screen.queryByText('Broken.pdf')).not.toBeInTheDocument();
  });

  it('15/16: switching between Documents and History triggers no CaseDocument fetch/mutation, no generation, and no archive call', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-active', fileName: 'active.pdf', status: 'active' }),
      makeDocument({ id: 'doc-superseded', fileName: 'old.pdf', status: 'superseded' }),
    ]);
    renderTab();

    await screen.findByText('active.pdf');
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    await screen.findByText('old.pdf');
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    await screen.findByText('active.pdf');

    expect(caseDocumentsClient.fetchCaseDocuments).toHaveBeenCalledTimes(1);
    expect(caseDocumentsClient.generateCaseDocument).not.toHaveBeenCalled();
    expect(caseDocumentsClient.archiveCaseDocument).not.toHaveBeenCalled();
  });
});
