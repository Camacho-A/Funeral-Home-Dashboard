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
  return { ...actual, fetchCaseDocuments: vi.fn(), archiveCaseDocument: vi.fn() };
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
vi.mock('@/utils/print', () => ({
  printStoredDocument: (...args: unknown[]) => mockPrintStoredDocument(...args),
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

  it('13: does not offer a bulk "Print All" action — real per-document authorized fetches aren\'t safely batchable, so none is faked', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-1', fileName: 'one.pdf' }),
      makeDocument({ id: 'doc-2', fileName: 'two.pdf' }),
    ]);
    renderTab();

    await screen.findByText('one.pdf');
    expect(screen.queryByRole('button', { name: /print all/i })).not.toBeInTheDocument();
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

  it('6/7: an existing archived Manors document remains visible in the list and remains downloadable/printable — this task disables NEW archive actions only, it is not a migration', async () => {
    mockOrganization({ id: DEFAULT_ORGANIZATION_ID });
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([
      makeDocument({ id: 'doc-already-archived', fileName: 'old-scan.pdf', status: 'archived' }),
    ]);
    renderTab(DEFAULT_ORGANIZATION_ID);

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
