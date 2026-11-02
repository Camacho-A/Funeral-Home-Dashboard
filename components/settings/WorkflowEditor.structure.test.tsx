import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowEditor } from './WorkflowEditor';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { buildGusServiceWorkflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { StageTemplate, WorkflowTemplate } from '@/types/workflowTemplate';

/**
 * Workflow template editor (2026-10). Structural editing (stages and
 * items), item requirements, service assignment, preview, and the
 * approval gate — through the real component and domain functions, with
 * only the network-facing workflow-template service stubbed. Fictional
 * mock data only.
 */

vi.mock('@/services/workflowTemplatesService', () => ({
  workflowTemplatesService: { list: vi.fn(), get: vi.fn(), getEnabledForCaseType: vi.fn(), createVersion: vi.fn(), approveVersion: vi.fn() },
}));

const GUS = 'gus-camacho-jr';
const gusCatalog = serviceCatalogFixtures.filter((item) => item.organizationId === GUS);
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ catalog: gusCatalog }) })));

const gusTemplates = buildGusServiceWorkflowTemplateFixtures();
const direct = gusTemplates[0];
const graveside = gusTemplates.find((t) => t.serviceTypeCodes?.includes('GRAVESIDE_BURIAL_SERVICE_ONLY'))!;

/** A small template with no intake links, for a Manors-style organization. */
const SIMPLE: WorkflowTemplate = {
  id: 'simple',
  organizationId: DEFAULT_ORGANIZATION_ID,
  name: 'Example Workflow',
  isEnabled: true,
  caseTypes: ['cremation'],
  versions: [
    {
      version: 1,
      caseTypes: ['cremation'],
      createdAt: '2026-01-01T00:00:00.000Z',
      intake: { sections: [{ key: 'd', label: 'Decedent', fields: [{ key: 'decedentName', label: 'Full name' }] }] },
      stages: [
        { rawStage: 0, displayStage: 0, label: 'Intake', isAttentionStage: false, slaTargetDays: 1, checklist: { items: [{ index: 0, label: 'Call received', hasField: false }, { index: 1, label: 'Family contacted', hasField: false }] } },
        { rawStage: 1, displayStage: 1, label: 'Paperwork', isAttentionStage: false, slaTargetDays: 2, checklist: { items: [{ index: 0, label: 'Forms filed', hasField: false }] } },
        { rawStage: 2, displayStage: 2, label: 'Completed', isAttentionStage: false, slaTargetDays: null, checklist: { items: [] } },
      ],
    },
  ],
};

function renderEditor(organizationId: string, template: WorkflowTemplate) {
  vi.mocked(workflowTemplatesService.get).mockResolvedValue(template);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationProvider organizationId={organizationId}>
        <WorkflowEditor templateId={template.id} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
  return screen.findByText(template.name);
}

async function savedInput() {
  fireEvent.click(screen.getByRole('button', { name: /save as (new|draft) version/i }));
  await waitFor(() => expect(workflowTemplatesService.createVersion).toHaveBeenCalled());
  return vi.mocked(workflowTemplatesService.createVersion).mock.calls[0][2];
}

const numbering = (stages: StageTemplate[]) => stages.map((s) => [s.rawStage, s.displayStage, s.label]);

beforeEach(() => {
  vi.mocked(workflowTemplatesService.list).mockResolvedValue(gusTemplates);
  vi.mocked(workflowTemplatesService.createVersion).mockImplementation(async (_ctx, _id, input) => ({
    ...SIMPLE,
    versions: [...SIMPLE.versions, { ...SIMPLE.versions[0], version: 2, stages: input.stages, intake: input.intake }],
  }));
});
afterEach(() => vi.clearAllMocks());

describe('WorkflowEditor — stages', () => {
  it('adds a stage before Completed, renames it, gives it an item, and saves coherent numbering', async () => {
    // Structure editing is offered where versions go through approval (Gus).
    await renderEditor(GUS, SIMPLE);
    fireEvent.click(screen.getByRole('button', { name: '+ Add stage' }));
    fireEvent.change(screen.getByDisplayValue('New stage'), { target: { value: 'Review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist item to "Review"' }));
    fireEvent.change(screen.getByDisplayValue('New checklist item'), { target: { value: 'Reviewed by director' } });
    const input = await savedInput();
    expect(numbering(input.stages)).toEqual([
      [0, 0, 'Intake'],
      [1, 1, 'Paperwork'],
      [2, 2, 'Review'],
      [3, 3, 'Completed'],
    ]);
    expect(input.stages[2].checklist.items).toEqual([{ index: 0, label: 'Reviewed by director', hasField: false, isPasswordField: false, externalFormIntegrationId: null }]);
  });

  it('removes a stage and renumbers', async () => {
    // Structure editing is offered where versions go through approval (Gus).
    await renderEditor(GUS, SIMPLE);
    fireEvent.click(screen.getByRole('button', { name: 'Remove stage "Paperwork"' }));
    const input = await savedInput();
    expect(numbering(input.stages)).toEqual([
      [0, 0, 'Intake'],
      [1, 1, 'Completed'],
    ]);
  });

  it('reorders stages; a stage whose checklist intake fields fill stays first', async () => {
    await renderEditor(GUS, direct);
    // Gus' intake fills First Call & Payment's items, so it is pinned.
    expect(screen.getByRole('button', { name: 'Move "First Call & Payment" down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move "JotForm Application" up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove stage "First Call & Payment"' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move "EDRS & Doctor / Cause of Death" up' }));
    const input = await savedInput();
    expect(numbering(input.stages).slice(0, 4)).toEqual([
      [0, 0, 'First Call & Payment'],
      [1, 0, 'First Call & Payment'],
      [2, 1, 'EDRS & Doctor / Cause of Death'],
      [3, 2, 'JotForm Application'],
    ]);
  });

  it('shows every structural problem and blocks saving', async () => {
    // Structure editing is offered where versions go through approval (Gus).
    await renderEditor(GUS, SIMPLE);
    fireEvent.change(screen.getByLabelText('Stage 2 name'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('"Intake" checklist item 1'), { target: { value: ' ' } });
    const alert = screen.getByTestId('workflow-save-problems');
    expect(within(alert).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /save as (new|draft) version/i })).toBeDisabled();
  });
});

describe('WorkflowEditor — checklist items', () => {
  it('renames, adds, removes and reorders items', async () => {
    // Structure editing is offered where versions go through approval (Gus).
    await renderEditor(GUS, SIMPLE);
    fireEvent.change(screen.getByDisplayValue('Forms filed'), { target: { value: 'Forms filed with county' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move item 1 of "Intake" down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist item to "Paperwork"' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 2 from "Intake"' }));
    const input = await savedInput();
    expect(input.stages[0].checklist.items.map((i) => [i.index, i.label])).toEqual([[0, 'Family contacted']]);
    expect(input.stages[1].checklist.items.map((i) => [i.index, i.label])).toEqual([
      [0, 'Forms filed with county'],
      [1, 'New checklist item'],
    ]);
  });

  it('reordering First Call items re-points the intake fields that fill them; an item a field fills cannot be removed', async () => {
    await renderEditor(GUS, direct);
    expect(screen.getByRole('button', { name: 'Remove item 1 from "First Call & Payment"' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove item 9 from "First Call & Payment"' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move item 1 of "First Call & Payment" down' }));
    const input = await savedInput();
    for (const raw of input.stages.slice(0, 2)) {
      expect(raw.checklist.items.slice(0, 2).map((i) => i.label)).toEqual(['Place of death — name, address & phone number', 'Name of deceased']);
    }
    const fields = input.intake.sections.flatMap((s) => s.fields);
    expect(fields.find((f) => f.key === 'decedentName')!.checklistItemIndex).toBe(1);
    expect(fields.find((f) => f.key === 'placeOfDeath')!.checklistItemIndex).toBe(0);
    expect(fields.find((f) => f.key === 'timeOfDeath')!.checklistItemIndex).toBe(5);
  });

  it('configures requirements the engine supports: data entry, 12-hour time picker, masked, completion from case fields', async () => {
    await renderEditor(GUS, direct);
    // Time of death keeps — and shows — its 12-hour picker.
    expect(screen.getByLabelText('Checklist item "Time of death" uses the 12-hour time picker')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByLabelText('Checklist item "Weight" uses the 12-hour time picker'));
    fireEvent.click(screen.getByLabelText('Checklist item "Weight" is masked'));
    fireEvent.click(screen.getByLabelText('Checklist item "Payment collected" is completed from case fields'));
    fireEvent.click(screen.getByLabelText('Checklist item "Payment collected" requires Next of kin — email'));
    // Data entry is only offered on the first stage.
    expect(screen.queryByLabelText('Checklist item "Cause of death entered" is a data-entry item')).toBeNull();
    const input = await savedInput();
    const [first, second] = input.stages;
    expect(first.checklist.items[3]).toMatchObject({ label: 'Weight', hasField: true, valueKind: 'time', isPasswordField: true });
    expect(second.checklist.items[3]).toMatchObject({ hasField: false, valueKind: 'time', isPasswordField: true });
    expect(first.checklist.items[5]).toMatchObject({ label: 'Time of death', valueKind: 'time' });
    expect(first.checklist.items[8].requiredCaseFields).toEqual(['nextOfKinEmail']);
  });
});

describe('WorkflowEditor — service assignment, preview and approval (Gus)', () => {
  it('assigns the workflow to an active service and saves it with the draft', async () => {
    await renderEditor(GUS, graveside);
    const assignment = await screen.findByTestId('workflow-service-assignment');
    await waitFor(() => expect(within(assignment).getByLabelText('Serves Direct Cremation')).toBeInTheDocument());
    expect(within(assignment).getByLabelText('Serves Graveside Burial Service Only (No Viewing)')).toHaveAttribute('aria-checked', 'true');
    expect(within(assignment).getByText(/served by “Direct Cremation”/)).toBeInTheDocument();
    fireEvent.click(within(assignment).getByLabelText('Serves U.S. Veterans, Graveside Burial Service Only (No Viewing)'));
    const input = await savedInput();
    expect(input.serviceTypeCodes).toEqual(['GRAVESIDE_BURIAL_SERVICE_ONLY', 'VETERANS_GRAVESIDE_BURIAL_SERVICE_ONLY']);
  });

  it('previews the workflow read-only, as staff will see it', async () => {
    await renderEditor(GUS, direct);
    expect(screen.queryByTestId('workflow-preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview workflow' }));
    const preview = screen.getByTestId('workflow-preview');
    const stepper = within(preview).getByRole('list', { name: 'Workflow stages' });
    expect(within(stepper).getAllByRole('listitem')).toHaveLength(7);
    expect(within(preview).getByText('Time of death').parentElement).toHaveTextContent('12-hour time picker');
    expect(within(preview).getByText('Certifier Information').parentElement).toHaveTextContent('Completed from case information: Certifier — name, Certifier — fax number');
    fireEvent.click(within(stepper).getByRole('button', { name: /Ready for Pickup/ }));
    expect(within(preview).getByText('Transferred to urn')).toBeInTheDocument();
    expect(within(preview).queryByRole('textbox')).toBeNull();
  });

  it('disables "Approve" for an incomplete draft and lists why; the unsaved draft shows the same rules', async () => {
    await renderEditor(GUS, graveside);
    const problems = await screen.findByTestId('workflow-version-problems-1');
    expect(problems).toHaveTextContent('Stage "Graveside burial — steps to be defined" has no checklist items.');
    expect(screen.getByRole('button', { name: 'Approve version 1' })).toBeDisabled();
    expect(screen.getByTestId('workflow-draft-approval-problems')).toHaveTextContent('has no checklist items');

    // 2026-10: the placeholder is refused by name, and the completion
    // requirements are still to be defined.
    expect(problems).toHaveTextContent('is a placeholder');
    expect(problems).toHaveTextContent('Completion requirements are not defined');
    expect(screen.getByTestId('workflow-completion-undefined')).toBeInTheDocument();

    // Defining the step (fictional), naming the stage, and choosing the item
    // that completes a case clears the draft's approval problems.
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist item to "Graveside burial — steps to be defined"' }));
    fireEvent.change(screen.getByLabelText('Stage 5 name'), { target: { value: 'Example graveside stage' } });
    fireEvent.click(within(screen.getByTestId('workflow-completion-section')).getByLabelText('Require "New checklist item" to complete a case'));
    await waitFor(() => expect(screen.getByTestId('workflow-draft-ready')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /save as draft version/i })).not.toBeDisabled();
  });

  it('enables "Approve" for a complete draft and shows the server’s problem list if approval is refused', async () => {
    // Direct Cremation's current version (v2, the shared foundation) re-saved as draft v3.
    const complete = structuredClone(direct);
    complete.versions.push({ ...structuredClone(direct.versions[1]), version: 3, status: 'draft', createdBy: 'identity-x', createdByName: 'Example Admin' });
    complete.versions[1] = { ...complete.versions[1], approvedBy: 'identity-y', approvedByName: 'Example Approver', approvedAt: '2026-10-02T00:00:00.000Z' };
    vi.mocked(workflowTemplatesService.approveVersion).mockRejectedValue(
      Object.assign(new Error('Version 3 cannot be approved until these problems are fixed.'), { details: ['Example problem from the server.'] }),
    );
    await renderEditor(GUS, complete);
    expect(screen.getByTestId('workflow-version-author-3')).toHaveTextContent('Saved by Example Admin');
    expect(screen.getByTestId('workflow-version-approver-2')).toHaveTextContent('Approved by Example Approver on');
    const approveButton = await screen.findByRole('button', { name: 'Approve version 3' });
    await waitFor(() => expect(approveButton).not.toBeDisabled());
    fireEvent.click(approveButton);
    const attestation = screen.getByTestId('workflow-approval-attestation');
    for (const box of within(attestation).getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('cannot be approved');
    expect(alert).toHaveTextContent('Example problem from the server.');
  });
});
