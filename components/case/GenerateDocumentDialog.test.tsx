import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GenerateDocumentDialog } from './GenerateDocumentDialog';
import * as documentTemplatesClient from '@/lib/documentTemplatesClient';
import * as caseDocumentsClient from '@/lib/caseDocumentsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { DocumentTemplate } from '@/types/documentTemplate';
import type { CaseDocument } from '@/types/caseDocument';

vi.mock('@/lib/documentTemplatesClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/documentTemplatesClient')>('@/lib/documentTemplatesClient');
  return { ...actual, fetchDocumentTemplates: vi.fn(), previewDocumentTemplate: vi.fn() };
});

vi.mock('@/lib/caseDocumentsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/caseDocumentsClient')>('@/lib/caseDocumentsClient');
  return { ...actual, generateCaseDocument: vi.fn() };
});

const TEMPLATE: DocumentTemplate = {
  id: 'template-1',
  organizationId: DEFAULT_ORGANIZATION_ID,
  isSystemTemplate: false,
  name: 'Cremation Authorization',
  documentTypeKey: 'authorization.cremation',
  category: 'authorization',
  status: 'active',
  versions: [
    { templateId: 'template-1', version: 1, body: '<p>v1 body {{case.decedent.fullName}}</p>', mergeFieldsUsed: ['case.decedent.fullName'], createdAt: '2026-07-01T00:00:00.000Z', createdBy: 'identity-1' },
    { templateId: 'template-1', version: 2, body: '<p>v2 body {{case.decedent.fullName}}</p>', mergeFieldsUsed: ['case.decedent.fullName'], createdAt: '2026-07-15T00:00:00.000Z', createdBy: 'identity-1' },
  ],
};

const ARCHIVED_TEMPLATE: DocumentTemplate = { ...TEMPLATE, id: 'template-archived', name: 'Retired Letter', status: 'archived' };

function makeDocument(overrides: Partial<CaseDocument> = {}): CaseDocument {
  return {
    id: 'doc-new',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    origin: 'generated',
    documentTypeKey: 'authorization.cremation',
    category: 'authorization',
    fileName: 'Cremation Authorization.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1,
    checksumSha256: 'abc',
    storageKey: 'key',
    status: 'active',
    templateId: 'template-1',
    templateVersion: 2,
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

function renderDialog(props: Partial<Parameters<typeof GenerateDocumentDialog>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <GenerateDocumentDialog open onClose={onClose} organizationId={DEFAULT_ORGANIZATION_ID} caseId="case-1" regenerating={null} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

beforeEach(() => {
  vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([TEMPLATE, ARCHIVED_TEMPLATE]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GenerateDocumentDialog — template selection', () => {
  it('lists only active templates, excluding archived ones', async () => {
    renderDialog();
    expect(await screen.findByRole('option', { name: 'Cremation Authorization' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Retired Letter' })).not.toBeInTheDocument();
  });

  it('shows a version selector defaulting to "Current latest" once a template is selected', async () => {
    renderDialog();
    await screen.findByRole('option', { name: 'Cremation Authorization' });
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'template-1' } });

    expect(await screen.findByLabelText('Template version')).toHaveValue('');
    expect(screen.getByText('Current latest (v2)')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'v1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'v2' })).toBeInTheDocument();
  });

  it('disables the template select and pre-selects it when regenerating an existing document', async () => {
    renderDialog({ regenerating: makeDocument({ templateId: 'template-1' }) });
    await waitFor(() => expect(screen.getByLabelText('Template')).toHaveValue('template-1'));
    expect(screen.getByLabelText('Template')).toBeDisabled();
  });
});

describe('GenerateDocumentDialog — preview', () => {
  it('previews the current latest version with no ad hoc body override when none is explicitly chosen', async () => {
    vi.mocked(documentTemplatesClient.previewDocumentTemplate).mockResolvedValue('<p>Merged v2</p>');
    renderDialog();
    await screen.findByRole('option', { name: 'Cremation Authorization' });
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'template-1' } });
    await screen.findByLabelText('Template version');

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() =>
      expect(documentTemplatesClient.previewDocumentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: 'template-1', caseId: 'case-1' }),
      ),
    );
    const call = vi.mocked(documentTemplatesClient.previewDocumentTemplate).mock.calls[0][0];
    expect(call.body).toBeUndefined();
    expect(await screen.findByText('Merged v2')).toBeInTheDocument();
  });

  it('resolves the selected non-latest version\'s own body client-side and passes it as an ad hoc override', async () => {
    vi.mocked(documentTemplatesClient.previewDocumentTemplate).mockResolvedValue('<p>Merged v1</p>');
    renderDialog();
    await screen.findByRole('option', { name: 'Cremation Authorization' });
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'template-1' } });
    await screen.findByLabelText('Template version');
    fireEvent.change(screen.getByLabelText('Template version'), { target: { value: '1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() =>
      expect(documentTemplatesClient.previewDocumentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: 'template-1', caseId: 'case-1', body: TEMPLATE.versions[0].body }),
      ),
    );
    expect(await screen.findByText('Merged v1')).toBeInTheDocument();
  });

  it('shows an inline error rather than closing the dialog when preview fails', async () => {
    vi.mocked(documentTemplatesClient.previewDocumentTemplate).mockRejectedValue(new Error('Failed to render preview.'));
    const { onClose } = renderDialog();
    await screen.findByRole('option', { name: 'Cremation Authorization' });
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'template-1' } });
    await screen.findByLabelText('Template version');

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText('Failed to render preview.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('GenerateDocumentDialog — generate', () => {
  it('generates against the selected template and closes the dialog on success', async () => {
    vi.mocked(caseDocumentsClient.generateCaseDocument).mockResolvedValue(makeDocument());
    const { onClose } = renderDialog();
    await screen.findByRole('option', { name: 'Cremation Authorization' });
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'template-1' } });
    await screen.findByLabelText('Template version');

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(caseDocumentsClient.generateCaseDocument).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', templateId: 'template-1', templateVersion: undefined, existingDocumentId: undefined }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('passes existingDocumentId and the explicitly chosen templateVersion when regenerating', async () => {
    vi.mocked(caseDocumentsClient.generateCaseDocument).mockResolvedValue(makeDocument());
    const regenerating = makeDocument({ id: 'doc-old', templateId: 'template-1' });
    renderDialog({ regenerating });
    await waitFor(() => expect(screen.getByLabelText('Template')).toHaveValue('template-1'));
    await screen.findByLabelText('Template version');
    fireEvent.change(screen.getByLabelText('Template version'), { target: { value: '1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));

    await waitFor(() =>
      expect(caseDocumentsClient.generateCaseDocument).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: 'template-1', templateVersion: 1, existingDocumentId: 'doc-old' }),
      ),
    );
  });

  it('shows an inline error rather than closing the dialog when generation fails', async () => {
    vi.mocked(caseDocumentsClient.generateCaseDocument).mockRejectedValue(new Error('Document storage is not configured.'));
    const { onClose } = renderDialog();
    await screen.findByRole('option', { name: 'Cremation Authorization' });
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'template-1' } });
    await screen.findByLabelText('Template version');

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('Document storage is not configured.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables the Generate button until a template is selected', async () => {
    renderDialog();
    await screen.findByText('Select a template…');
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });
});
