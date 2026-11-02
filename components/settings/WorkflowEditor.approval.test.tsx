import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowEditor } from './WorkflowEditor';
import { WorkflowTemplatesPanel } from './WorkflowTemplatesPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import { buildGusServiceWorkflowTemplateFixtures, standardCremationWorkflowTemplateFixture } from '@/services/__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

/**
 * Service-specific workflows (2026-10). Settings › Workflow Templates shows
 * Draft/Approved status and an in-page-confirmed "Approve version" action
 * for Gus; Manors sees none of it. Fictional mock data, stubbed service.
 */

vi.mock('@/services/workflowTemplatesService', () => ({
  workflowTemplatesService: { list: vi.fn(), get: vi.fn(), getEnabledForCaseType: vi.fn(), createVersion: vi.fn(), approveVersion: vi.fn() },
}));
// The Gus service catalog as /api/service-catalog serves it (fictional mock data).
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ catalog: serviceCatalogFixtures.filter((item) => item.organizationId === 'gus-camacho-jr') }) })));

const GUS = 'gus-camacho-jr';

function renderWith(organizationId: string, ui: React.ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationProvider organizationId={organizationId}>{ui}</OrganizationProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('WorkflowEditor — approval (Gus)', () => {
  const templates = buildGusServiceWorkflowTemplateFixtures();
  const viewing = templates.find((t) => t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;
  const graveside = templates.find((t) => t.serviceTypeCodes?.includes('GRAVESIDE_BURIAL_SERVICE_ONLY'))!;
  /** Cremation with Viewing with its version still a draft (as after an edit). */
  const draftViewing = (): WorkflowTemplate => {
    const draft = structuredClone(viewing);
    draft.versions[0].status = 'draft';
    return draft;
  };

  it('marks a draft, explains it cannot be used, and approves only after the in-page confirmation', async () => {
    const approved: WorkflowTemplate = structuredClone(viewing);
    approved.versions[0].status = 'approved';
    vi.mocked(workflowTemplatesService.get).mockResolvedValue(draftViewing());
    vi.mocked(workflowTemplatesService.approveVersion).mockResolvedValue(approved);
    const confirmPrompt = vi.spyOn(window, 'confirm');

    renderWith(GUS, <WorkflowEditor templateId={viewing.id} />);
    expect(await screen.findByTestId('workflow-version-status-1')).toHaveTextContent('Draft — requires approval');
    expect(screen.getByTestId('workflow-not-approved')).toBeInTheDocument();
    expect(screen.getByText(/The shared cremation process/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve version 1' }));
    expect(screen.getByTestId('workflow-approval-confirm')).toBeInTheDocument();
    expect(workflowTemplatesService.approveVersion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('workflow-approval-confirm')).toBeNull();
    expect(workflowTemplatesService.approveVersion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Approve version 1' }));
    // 2026-10: the review attestation must be affirmed in the page first.
    expect(screen.getByRole('button', { name: 'Confirm approval' })).toBeDisabled();
    for (const box of within(screen.getByTestId('workflow-approval-attestation')).getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    await waitFor(() =>
      expect(workflowTemplatesService.approveVersion).toHaveBeenCalledWith(expect.objectContaining({ organizationId: GUS }), viewing.id, 1, {
        stagesReviewed: true,
        checklistReviewed: true,
        completionReviewed: true,
      }),
    );
    expect(await screen.findByTestId('workflow-version-status-1')).toHaveTextContent('Approved');
    expect(confirmPrompt).not.toHaveBeenCalled();
  });

  it('lists every Gus template with its approval status', async () => {
    vi.mocked(workflowTemplatesService.list).mockResolvedValue(templates);
    vi.mocked(workflowTemplatesService.get).mockResolvedValue(templates[0]);
    renderWith(GUS, <WorkflowTemplatesPanel />);
    expect(await screen.findByTestId(`workflow-template-approval-${templates[0].id}`)).toHaveTextContent('Approved');
    expect(screen.getByTestId(`workflow-template-approval-${viewing.id}`)).toHaveTextContent('Approved');
    expect(screen.getByTestId(`workflow-template-approval-${graveside.id}`)).toHaveTextContent('Draft — requires approval');
  });
});

describe('WorkflowEditor — Manors unchanged', () => {
  it('shows no approval status or action', async () => {
    vi.mocked(workflowTemplatesService.get).mockResolvedValue(standardCremationWorkflowTemplateFixture);
    renderWith('managed-cremations', <WorkflowEditor templateId={standardCremationWorkflowTemplateFixture.id} />);
    expect(await screen.findByText('Version history')).toBeInTheDocument();
    expect(screen.queryByText(/requires approval/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Approve version/ })).toBeNull();
    expect(screen.queryByTestId('workflow-template-services')).toBeNull();
  });
});
