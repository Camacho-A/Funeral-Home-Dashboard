import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowTemplatesPanel } from './WorkflowTemplatesPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

/**
 * Task #11 (2026-09, Settings organization cleanup). Extracted from
 * SettingsHub.test.tsx's own "Workflow Templates" coverage now that this
 * area is its own dedicated `/settings/workflow-templates` page rather
 * than an always-rendered section on the Settings hub — mirrors every
 * other settings sub-page's own dedicated `*Panel.test.tsx` file
 * (CaseNumberingPanel.test.tsx, OrganizationProfilePanel.test.tsx, ...).
 * WorkflowTemplateList/WorkflowEditor each already have their own,
 * deeper unit tests (WorkflowTemplateList.test.tsx, WorkflowEditor.test.tsx)
 * — this file only verifies the wiring: loading state, default selection,
 * and switching which template's editor is shown.
 */
vi.mock('@/services/workflowTemplatesService', () => ({
  workflowTemplatesService: { list: vi.fn(), get: vi.fn(), getEnabledForCaseType: vi.fn(), createVersion: vi.fn() },
}));

function template(overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id: 'template-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    name: 'Standard Cremation Workflow',
    isEnabled: true,
    caseTypes: ['cremation'],
    versions: [
      {
        version: 1,
        caseTypes: ['cremation'],
        createdAt: '2026-01-01T00:00:00.000Z',
        intake: { sections: [] },
        stages: [
          {
            rawStage: 0,
            displayStage: 0,
            label: 'First Call & Payment',
            isAttentionStage: false,
            slaTargetDays: 1,
            checklist: { items: [{ index: 0, label: 'Family contacted', hasField: false }] },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <WorkflowTemplatesPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(workflowTemplatesService.get).mockImplementation(async (_org, id) =>
    id === 'template-2' ? template({ id: 'template-2', name: 'Direct Burial Workflow' }) : template(),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('WorkflowTemplatesPanel', () => {
  it('shows a loading state before the templates list resolves', async () => {
    vi.mocked(workflowTemplatesService.list).mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByText('Loading workflow templates…')).toBeInTheDocument();
  });

  it('renders the explanatory description text', async () => {
    vi.mocked(workflowTemplatesService.list).mockResolvedValue([template()]);
    renderPanel();
    expect(await screen.findByText(/manage this organization/i)).toBeInTheDocument();
  });

  it('defaults to the first template and shows its editor', async () => {
    vi.mocked(workflowTemplatesService.list).mockResolvedValue([template()]);
    renderPanel();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Standard Cremation Workflow' })).toBeInTheDocument());
  });

  it('switches the shown editor when a different template is selected', async () => {
    vi.mocked(workflowTemplatesService.list).mockResolvedValue([
      template(),
      template({ id: 'template-2', name: 'Direct Burial Workflow' }),
    ]);
    renderPanel();
    await screen.findByRole('heading', { name: 'Standard Cremation Workflow' });

    fireEvent.click(screen.getByText('Direct Burial Workflow'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Direct Burial Workflow' })).toBeInTheDocument());
  });

  it('shows the empty state when the organization has no workflow templates', async () => {
    vi.mocked(workflowTemplatesService.list).mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText('No workflow templates configured for this organization yet.')).toBeInTheDocument();
  });
});
