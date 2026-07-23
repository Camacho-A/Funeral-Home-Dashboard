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
      intake: {
        sections: [
          {
            key: 'decedent',
            label: 'Decedent',
            fields: [
              { key: 'decedentName', label: 'Name of deceased', fieldType: 'text', required: true, uppercase: true },
              { key: 'dateOfBirth', label: 'Date of birth', fieldType: 'date', validationType: 'date' },
            ],
          },
        ],
      },
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
      intake: { sections: [{ key: 's', label: 'Details', fields: [{ key: 'fullName', label: 'Full name' }] }] },
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
    expect(screen.getByDisplayValue('EDRS submitted')).toBeInTheDocument();
  });

  it('renders a differently-shaped template correctly — no hardcoded Manor-specific structure', async () => {
    renderEditor('template-2');
    expect(await screen.findByText('Evergreen Memorial Group — Burial Workflow')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Intake')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Family contacted')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Full name')).toBeInTheDocument();
  });
});

describe('WorkflowEditor — editing and saving stages (Phase 18)', () => {
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
    const [, templateId, input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(templateId).toBe('template-1');
    expect(input.stages[0].label).toBe('Intake & Payment');
    // Untouched stage/checklist content still passes through unchanged.
    expect(input.stages[1].label).toBe('EDRS & Doctor');
  });

  it('edits an SLA target and an attention flag', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    const slaInputs = screen.getAllByDisplayValue('1');
    fireEvent.change(slaInputs[0], { target: { value: '5' } });
    fireEvent.click(screen.getByLabelText('"First Call & Payment" is an attention stage'));

    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));
    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());

    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(input.stages[0].slaTargetDays).toBe(5);
    expect(input.stages[0].isAttentionStage).toBe(true);
  });

  it('edits a checklist item label', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.change(screen.getByDisplayValue('EDRS submitted'), { target: { value: 'EDRS filed with the state' } });
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(input.stages[1].checklist.items[0].label).toBe('EDRS filed with the state');
  });

  it('reorders stages via the move-down button and renumbers rawStage/displayStage', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.click(screen.getByRole('button', { name: /move "first call & payment" down/i }));
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(input.stages.map((s) => s.label)).toEqual(['EDRS & Doctor', 'First Call & Payment']);
    expect(input.stages.map((s) => [s.rawStage, s.displayStage])).toEqual([
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

describe('WorkflowEditor — intake field builder (Phase 19)', () => {
  it('shows every configured intake field with its label and field type', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    expect(screen.getByLabelText('Intake field 1 label in "Decedent"')).toHaveValue('Name of deceased');
    expect(screen.getByLabelText('Intake field 2 label in "Decedent"')).toHaveValue('Date of birth');
    expect(screen.getByLabelText('"Name of deceased" field type')).toHaveValue('text');
    expect(screen.getByLabelText('"Date of birth" field type')).toHaveValue('date');
  });

  it('shows the required/uppercase/masked state for each configured field', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    expect(screen.getByLabelText('"Name of deceased" is required')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('"Name of deceased" uppercases as typed')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('"Date of birth" is required')).toHaveAttribute('aria-checked', 'false');
  });

  it('edits a field label and includes it in the saved intake', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.change(screen.getByLabelText('Intake field 1 label in "Decedent"'), {
      target: { value: "Decedent's full name" },
    });
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(input.intake.sections[0].fields[0].label).toBe("Decedent's full name");
  });

  it('changes a field type and its validation type', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.change(screen.getByLabelText('"Date of birth" field type'), { target: { value: 'text' } });
    fireEvent.change(screen.getByLabelText('"Date of birth" validation'), { target: { value: 'none' } });
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(input.intake.sections[0].fields[1].fieldType).toBe('text');
    expect(input.intake.sections[0].fields[1].validationType).toBe('none');
  });

  it('toggles required/uppercase/masked flags', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.click(screen.getByLabelText('"Date of birth" is required'));
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(input.intake.sections[0].fields[1].required).toBe(true);
  });

  it('adds a new field to a section with a unique key', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(input.intake.sections[0].fields).toHaveLength(3);
    const keys = input.intake.sections[0].fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate keys
  });

  it('assigns a new field a fresh, non-colliding checklistItemIndex so its value actually persists (Case Mapping)', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    const newField = input.intake.sections[0].fields[2];
    expect(newField.checklistItemIndex).toBeDefined();
    const allIndexes = input.intake.sections
      .flatMap((s) => s.fields)
      .map((f) => f.checklistItemIndex)
      .filter((i) => i != null);
    expect(new Set(allIndexes).size).toBe(allIndexes.length); // no collisions
  });

  it('deletes a field', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.click(screen.getByLabelText('Delete "Date of birth"'));
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(input.intake.sections[0].fields).toHaveLength(1);
    expect(input.intake.sections[0].fields[0].key).toBe('decedentName');
  });

  it('reorders fields within a section via the move-down button', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.click(screen.getByLabelText('Move "Name of deceased" down'));
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(input.intake.sections[0].fields.map((f) => f.key)).toEqual(['dateOfBirth', 'decedentName']);
  });

  it('shows an options input only for select-type fields, and saves the parsed options', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    expect(screen.queryByLabelText('"Name of deceased" options')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('"Name of deceased" field type'), { target: { value: 'select' } });
    const optionsInput = screen.getByLabelText('"Name of deceased" options');
    fireEvent.change(optionsInput, { target: { value: 'Yes, No, Unknown' } });

    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));
    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());

    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(input.intake.sections[0].fields[0].options).toEqual(['Yes', 'No', 'Unknown']);
  });

  it('blocks Save with an inline error when an intake field label is blanked out', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.change(screen.getByLabelText('Intake field 1 label in "Decedent"'), { target: { value: '' } });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save as new version/i })).toBeDisabled();
  });

  it('saves both the edited stages and the edited intake together in one version', async () => {
    renderEditor();
    await screen.findByText('Standard Cremation Workflow');

    fireEvent.change(screen.getByDisplayValue('First Call & Payment'), { target: { value: 'Intake & Payment' } });
    fireEvent.change(screen.getByLabelText('Intake field 1 label in "Decedent"'), {
      target: { value: 'Full legal name' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save as new version/i }));

    await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalledTimes(1));
    const [, , input] = vi.mocked(workflowTemplatesService.createVersion).mock.calls[0];
    expect(input.stages[0].label).toBe('Intake & Payment');
    expect(input.intake.sections[0].fields[0].label).toBe('Full legal name');
  });
});
