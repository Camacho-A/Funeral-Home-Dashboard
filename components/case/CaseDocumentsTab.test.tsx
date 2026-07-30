import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseDocumentsTab } from './CaseDocumentsTab';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as caseDocumentsClient from '@/lib/caseDocumentsClient';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { CaseDocument } from '@/types/caseDocument';

vi.mock('@/lib/caseDocumentsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/caseDocumentsClient')>('@/lib/caseDocumentsClient');
  return { ...actual, fetchCaseDocuments: vi.fn(), archiveCaseDocument: vi.fn() };
});

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

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
    generatedBy: 'Dana',
    uploadedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <CaseDocumentsTab caseId="case-1" />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

beforeEach(() => {
  mockPermissions(['document.view', 'document.generate', 'document.upload', 'document.archive']);
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
  it('archives a document after confirming', async () => {
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    vi.mocked(caseDocumentsClient.archiveCaseDocument).mockResolvedValue(undefined);
    renderTab();

    await screen.findByText('Cremation Authorization.pdf');
    fireEvent.click(screen.getByText('Archive'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Cremation Authorization.pdf');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(caseDocumentsClient.archiveCaseDocument).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', documentId: 'doc-1' }),
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
