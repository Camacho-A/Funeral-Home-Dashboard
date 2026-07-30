import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DocumentTemplateLibraryPanel } from './DocumentTemplateLibraryPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as documentTemplatesClient from '@/lib/documentTemplatesClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { DocumentTemplate } from '@/types/documentTemplate';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/documentTemplatesClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/documentTemplatesClient')>('@/lib/documentTemplatesClient');
  return {
    ...actual,
    fetchDocumentTemplates: vi.fn(),
    createDocumentTemplate: vi.fn(),
    createDocumentTemplateVersion: vi.fn(),
    cloneDocumentTemplate: vi.fn(),
    archiveDocumentTemplate: vi.fn(),
    restoreDocumentTemplate: vi.fn(),
    previewDocumentTemplate: vi.fn(),
  };
});

function makeTemplate(overrides: Partial<DocumentTemplate> = {}): DocumentTemplate {
  return {
    id: 'template-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    isSystemTemplate: false,
    name: 'Cremation Authorization',
    documentTypeKey: 'authorization.cremation',
    category: 'authorization',
    status: 'active',
    versions: [{ templateId: 'template-1', version: 1, body: '<p>{{case.decedent.fullName}}</p>', mergeFieldsUsed: ['case.decedent.fullName'], createdAt: '2026-07-01T00:00:00.000Z', createdBy: 'identity-1' }],
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <DocumentTemplateLibraryPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('DocumentTemplateLibraryPanel — permission gating', () => {
  it('shows nothing to a role without document.template.read', async () => {
    mockPermissions([]);
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([makeTemplate()]);
    renderPanel();
    expect(await screen.findByText("You don't have access to the document template library for this organization.")).toBeInTheDocument();
  });

  it('hides New Template/Edit/Duplicate/Archive controls for a role with read but not manage', async () => {
    mockPermissions(['document.template.read']);
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([makeTemplate()]);
    renderPanel();
    await screen.findByText('Cremation Authorization');
    expect(screen.queryByRole('button', { name: '+ New Template' })).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Duplicate')).not.toBeInTheDocument();
  });
});

describe('DocumentTemplateLibraryPanel — template list', () => {
  beforeEach(() => {
    mockPermissions(['document.template.read', 'document.template.manage']);
  });

  it('shows an empty state when no templates match the current filters', async () => {
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText('No document templates match these filters.')).toBeInTheDocument();
  });

  it("lists a template's type, category, latest version, and status badge", async () => {
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([makeTemplate()]);
    renderPanel();
    const name = await screen.findByText('Cremation Authorization');
    const row = name.closest('div')!.parentElement!;
    expect(row).toHaveTextContent('Cremation Authorization · Authorizations · v1');
    expect(row).toHaveTextContent('Active');
  });

  it('filters the list to archived templates via the Status select', async () => {
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([
      makeTemplate({ id: 'active-1', name: 'Active One', status: 'active' }),
      makeTemplate({ id: 'archived-1', name: 'Archived One', status: 'archived' }),
    ]);
    renderPanel();
    await screen.findByText('Active One');
    expect(screen.queryByText('Archived One')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'archived' } });

    expect(await screen.findByText('Archived One')).toBeInTheDocument();
    expect(screen.queryByText('Active One')).not.toBeInTheDocument();
  });

  it('archives an active template', async () => {
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([makeTemplate()]);
    vi.mocked(documentTemplatesClient.archiveDocumentTemplate).mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText('Cremation Authorization');

    fireEvent.click(screen.getByText('Archive'));

    await waitFor(() =>
      expect(documentTemplatesClient.archiveDocumentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID, templateId: 'template-1' }),
      ),
    );
  });

  it('restores an archived template', async () => {
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([makeTemplate({ status: 'archived' })]);
    vi.mocked(documentTemplatesClient.restoreDocumentTemplate).mockResolvedValue(undefined);
    renderPanel();
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'archived' } });
    await screen.findByText('Cremation Authorization');

    fireEvent.click(screen.getByText('Restore'));

    await waitFor(() =>
      expect(documentTemplatesClient.restoreDocumentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID, templateId: 'template-1' }),
      ),
    );
  });

  it('duplicates a template using the entered name', async () => {
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([makeTemplate()]);
    vi.mocked(documentTemplatesClient.cloneDocumentTemplate).mockResolvedValue(makeTemplate({ id: 'template-2', name: 'Copy of Cremation Authorization' }));
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Copy of Cremation Authorization');
    renderPanel();
    await screen.findByText('Cremation Authorization');

    fireEvent.click(screen.getByText('Duplicate'));

    await waitFor(() =>
      expect(documentTemplatesClient.cloneDocumentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID, sourceTemplateId: 'template-1', name: 'Copy of Cremation Authorization' }),
      ),
    );
    promptSpy.mockRestore();
  });
});

describe('DocumentTemplateLibraryPanel — editor modal', () => {
  beforeEach(() => {
    mockPermissions(['document.template.read', 'document.template.manage']);
  });

  it('creates a new template with the chosen name/type/body', async () => {
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([]);
    vi.mocked(documentTemplatesClient.createDocumentTemplate).mockResolvedValue(makeTemplate());
    renderPanel();
    await screen.findByText('No document templates match these filters.');

    fireEvent.click(screen.getByRole('button', { name: '+ New Template' }));
    const dialog = await screen.findByRole('dialog', { name: 'New Document Template' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cremation Authorization' } });
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'authorization.cremation' } });
    fireEvent.change(screen.getByLabelText(/Body/), { target: { value: '<p>{{case.decedent.fullName}}</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));

    await waitFor(() =>
      expect(documentTemplatesClient.createDocumentTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: DEFAULT_ORGANIZATION_ID,
          name: 'Cremation Authorization',
          documentTypeKey: 'authorization.cremation',
          category: 'authorization',
          body: '<p>{{case.decedent.fullName}}</p>',
        }),
      ),
    );
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('editing an existing template saves a new version rather than mutating the current one, and locks name/type', async () => {
    const template = makeTemplate();
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([template]);
    vi.mocked(documentTemplatesClient.createDocumentTemplateVersion).mockResolvedValue(template);
    renderPanel();
    await screen.findByText('Cremation Authorization');

    fireEvent.click(screen.getByText('Edit'));
    await screen.findByRole('dialog', { name: 'Edit "Cremation Authorization"' });

    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Document type')).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Body/), { target: { value: '<p>Updated body {{case.decedent.fullName}}</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save New Version' }));

    await waitFor(() =>
      expect(documentTemplatesClient.createDocumentTemplateVersion).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID, templateId: 'template-1', body: '<p>Updated body {{case.decedent.fullName}}</p>' }),
      ),
    );
  });

  it('inserts a merge-field token at the end of the body when a merge field is clicked', async () => {
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([]);
    renderPanel();
    await screen.findByText('No document templates match these filters.');
    fireEvent.click(screen.getByRole('button', { name: '+ New Template' }));
    await screen.findByRole('dialog', { name: 'New Document Template' });

    fireEvent.click(screen.getByTitle('The full name of the decedent.'));

    expect((screen.getByLabelText(/Body/) as HTMLTextAreaElement).value).toContain('{{case.decedent.fullName}}');
  });

  it('previews the current draft body against sample data', async () => {
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([]);
    vi.mocked(documentTemplatesClient.previewDocumentTemplate).mockResolvedValue('<p>Merged sample</p>');
    renderPanel();
    await screen.findByText('No document templates match these filters.');
    fireEvent.click(screen.getByRole('button', { name: '+ New Template' }));
    await screen.findByRole('dialog', { name: 'New Document Template' });

    fireEvent.change(screen.getByLabelText(/Body/), { target: { value: '<p>{{case.decedent.fullName}}</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText('Merged sample')).toBeInTheDocument();
  });

  it('shows an inline error rather than closing the modal when saving fails', async () => {
    vi.mocked(documentTemplatesClient.fetchDocumentTemplates).mockResolvedValue([]);
    vi.mocked(documentTemplatesClient.createDocumentTemplate).mockRejectedValue(new Error('A template with this name already exists.'));
    renderPanel();
    await screen.findByText('No document templates match these filters.');
    fireEvent.click(screen.getByRole('button', { name: '+ New Template' }));
    const dialog = await screen.findByRole('dialog', { name: 'New Document Template' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cremation Authorization' } });
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'authorization.cremation' } });
    fireEvent.change(screen.getByLabelText(/Body/), { target: { value: '<p>{{case.decedent.fullName}}</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));

    expect(await screen.findByText('A template with this name already exists.')).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });
});
