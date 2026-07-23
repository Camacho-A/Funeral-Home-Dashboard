import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowEditor } from './WorkflowEditor';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

vi.mock('@/services/workflowTemplatesService', () => ({
  workflowTemplatesService: { list: vi.fn(), get: vi.fn(), getEnabledForCaseType: vi.fn(), createVersion: vi.fn() },
}));

const TEMPLATE: WorkflowTemplate = {
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
          checklist: { items: [{ index: 0, label: 'Name of deceased', hasField: true }] },
        },
        {
          rawStage: 1,
          displayStage: 1,
          label: 'EDRS & Doctor',
          isAttentionStage: true,
          slaTargetDays: 3,
          checklist: { items: [{ index: 0, label: 'EDRS submitted', hasField: false }] },
        },
      ],
    },
  ],
};

// A differently-shaped template — a different org's own terminology, no
// combined raw/display stages, no attention stage — proving the editor
// doesn't hardcode any Managed-Cremations-specific assumption.
const GENERIC_TEMPLATE: WorkflowTemplate = {
  id: 'template-2',
  organizationId: DEFAULT_ORGANIZATION_ID,
  name: 'Evergreen Memorial Group — Burial Workflow',
  isEnabled: true,
  caseTypes: ['burial'],
  versions: [
    {
      version: 1,
      caseTypes: ['burial'],
      createdAt: '2026-01-01T00:00:00.000Z',
      intake: { sections: [] },
      stages: [
        {
          rawStage: 0,
          displayStage: 0,
          label: 'Intake',
          isAttentionStage: false,
          slaTargetDays: 1,
          checklist: { items: [{ index: 0, label: 'Family contacted', hasField: false }] },
        },
      ],
    },
  ],
};

function renderEditor(templateId = 'template-1') {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <WorkflowEditor templateId={templateId} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(workflowTemplatesService.get).mockImplementation(async (_ctx, templateId: string) =>
    templateId === 'template-2' ? GENERIC_TEMPLATE : TEMPLATE,
  );
  vi.mocked(workflowTemplatesService.createVersion).mockResolvedValue({
    ...TEMPLATE,
    versions: [...TEMPLATE.versions, { ...TEMPLATE.versions[0], version: 2 }],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('WorkflowEditor — viewing (Phase 18)', () => {
  it('shows the template name, current version, and version history', async () => {
    renderEditor();
    expect(await screen.findByText('Standard Cremation Workflow')).toBeInTheDocument();
    expect(screen.getAllByText('Version 1').length).toBeGreaterThan(0);
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('shows every stage with its label, SLA target, attention flag, and checklist items', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    expect(screen.getByDisplayValue('First Call & Payment')).toBeInTheDocument();
    expect(screen.getByDisplayValue('EDRS & Doctor')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Name of deceased')).toBeInTheDocument();
    expect(screen.getByDisplayValue('EDRS submitted')).toBeInTheDocument();

    const attentionCheckboxes = screen.getAllByRole('checkbox');
    expect(attentionCheckboxes[0]).toHaveAttribute('aria-checked', 'false');
    expect(attentionCheckboxes[1]).toHaveAttribute('aria-checked', 'true');
  });

  it('renders a differently-shaped template correctly — no hardcoded Manor-specific structure', async () => {
    renderEditor('template-2');
    expect(await screen.findByText('Evergreen Memorial Group — Burial Workflow')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Intake')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Family contacted')).toBeInTheDocument();
  });
});

describe('WorkflowEditor — editing and saving (Phase 18)', () => {
  it('disables Save until something is actually edited', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');
    expect(screen.getByRole('button', { name: /save as new version/i })).toBeDisabled();
  });

  it('enables Save after editing a stage label, and submits the edited stages array', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    const label = screen.getByDisplayValue('First Call & Payment');
    fireEvent.change(label, { target: { value: 'Intake & Payment' } });

    const saveButton = screen.getByRole('button', { name: /save as new version/i });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, templateId, stages] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(templateId).toBe('template-1');
    expect(stages[0].label).toBe('Intake & Payment');
    // Untouched stage/checklist content still passes through unchanged.
    expect(stages[1].label).toBe('EDRS & Doctor');
  });

  it('edits an SLA target and an attention flag', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    const slaInputs = screen.getAllByDisplayValue('1');
    fireEvent.change(slaInputs[0], { target: { value: '5' } });
    fireEvent.click(screen.getAllByRole('checkbox')[0]); // toggle attention on stage 1

    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));
    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());

    const [, , stages] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(stages[0].slaTargetDays).toBe(5);
    expect(stages[0].isAttentionStage).toBe(true);
  });

  it('edits a checklist item label', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.change(screen.getByDisplayValue('Name of deceased'), { target: { value: "Decedent's full name" } });
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, , stages] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(stages[0].checklist.items[0].label).toBe("Decedent's full name");
  });

  it('reorders stages via the move-down button and renumbers rawStage/displayStage', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.click(screen.getByRole('button', { name: /move "first call & payment" down/i }));
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, , stages] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(stages.map((s: { label: string }) => s.label)).toEqual(['EDRS & Doctor', 'First Call & Payment']);
    expect(stages.map((s: { rawStage: number; displayStage: number }) => [s.rawStage, s.displayStage])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('blocks Save and shows an inline error when a stage label is blanked out', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.change(screen.getByDisplayValue('First Call & Payment'), { target: { value: '' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/non-empty label/i);
    expect(screen.getByRole('button', { name: /save as new version/i })).toBeDisabled();
    expect(workflowTemplatesService.createVersion).not.toHaveBeenCalled();
  });

  it('"Discard changes" reverts the draft to the latest saved version', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.change(screen.getByDisplayValue('First Call & Payment'), { target: { value: 'Something Else' } });
    fireEvent.click(screen.getByRole('button', { name: /discard changes/i }));

    expect(screen.getByDisplayValue('First Call & Payment')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Something Else')).not.toBeInTheDocument();
  });

  it('shows a server error message if saving fails, without losing the edit', async () => {
    vi.mocked(workflowTemplatesService.createVersion).mockRejectedValue(new Error('Invalid workflow structure.'));
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.change(screen.getByDisplayValue('First Call & Payment'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid workflow structure.'));
    expect(screen.getByDisplayValue('Renamed')).toBeInTheDocument();
  });
});
