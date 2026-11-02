import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkflowEditor } from './WorkflowEditor';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { workflowTemplatesService } from '@/services/workflowTemplatesService';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { buildGusServiceWorkflowTemplateFixtures, standardCremationWorkflowTemplateFixture } from '@/services/__mocks__/workflowTemplates';
import type { WorkflowTemplate } from '@/types/workflowTemplate';

/**
 * Service-specific completion (2026-10). Settings › Workflow Templates'
 * Completion section: configured per draft version, saved with it, shown
 * in the preview, and checked by the same approval rules the route
 * enforces. Gus only — Manors' editor is unchanged. Fictional steps only.
 */

vi.mock('@/services/workflowTemplatesService', () => ({
  workflowTemplatesService: { list: vi.fn(), get: vi.fn(), getEnabledForCaseType: vi.fn(), createVersion: vi.fn(), approveVersion: vi.fn() },
}));

const GUS = 'gus-camacho-jr';
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ catalog: serviceCatalogFixtures.filter((item) => item.organizationId === GUS) }) })));

const gusTemplates = buildGusServiceWorkflowTemplateFixtures();
const byCode = (code: string) => gusTemplates.find((t) => t.serviceTypeCodes?.includes(code))!;

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

beforeEach(() => {
  vi.mocked(workflowTemplatesService.list).mockResolvedValue(gusTemplates);
  vi.mocked(workflowTemplatesService.createVersion).mockImplementation(async () => byCode('GRAVESIDE_BURIAL_SERVICE_ONLY'));
});
afterEach(() => vi.clearAllMocks());

describe('WorkflowEditor — Completion section (Gus)', () => {
  it('a burial draft: no remains return, its note, and "not defined" — then defined from the template’s OWN items, saved and previewed', async () => {
    await renderEditor(GUS, byCode('GRAVESIDE_BURIAL_SERVICE_ONLY'));
    const section = screen.getByTestId('workflow-completion-section');
    expect(within(section).getByLabelText('Requires return of cremated remains')).toHaveAttribute('aria-checked', 'false');
    expect(within(section).getByTestId('workflow-completion-note')).toHaveTextContent('Service-specific completion requirements to be defined.');
    expect(within(section).getByTestId('workflow-completion-undefined')).toBeInTheDocument();
    // Nothing to choose yet: the final stages have no items, and nothing is invented.
    expect(within(section).queryAllByLabelText(/^Require ".*" to complete a case$/)).toHaveLength(0);
    expect(screen.getByTestId('workflow-draft-approval-problems')).toHaveTextContent('Completion requirements are not defined');

    fireEvent.click(screen.getByRole('button', { name: 'Add checklist item to "Graveside burial — steps to be defined"' }));
    fireEvent.change(screen.getByLabelText('Stage 5 name'), { target: { value: 'Example graveside stage' } });
    fireEvent.click(within(section).getByLabelText('Require "New checklist item" to complete a case'));
    expect(within(section).queryByTestId('workflow-completion-undefined')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('workflow-draft-ready')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Preview workflow' }));
    const preview = screen.getByTestId('workflow-preview-completion');
    expect(preview).toHaveTextContent('No cremated remains are returned');
    expect(preview).toHaveTextContent('Required final items: “New checklist item”');

    const input = await savedInput();
    expect(input.completionPolicy).toMatchObject({
      kind: 'final_items',
      requiresRemainsReturn: false,
      requiredFinalItems: [{ displayStage: 4, index: 0, label: 'New checklist item' }],
      manualCompletion: { allowed: false },
      archiveEligibility: 'on_completion',
    });
  });

  it('Direct Cremation shows its remains-return rule; manual completion and archiving are configurable and saved with the draft', async () => {
    await renderEditor(GUS, byCode('DIRECT_CREMATION'));
    const section = screen.getByTestId('workflow-completion-section');
    expect(within(section).getByLabelText('Requires return of cremated remains')).toHaveAttribute('aria-checked', 'true');
    // Unchanged policy -> nothing to save.
    expect(screen.getByRole('button', { name: /save as draft version/i })).toBeDisabled();

    fireEvent.click(within(section).getByLabelText('Allow manual completion'));
    fireEvent.change(within(section).getByLabelText('Who may complete a case manually'), { target: { value: 'case.update' } });
    fireEvent.change(within(section).getByLabelText('Archiving after completion'), { target: { value: 'manual' } });
    fireEvent.click(within(section).getByLabelText('Require "Family contacted — ashes ready for pickup" to complete a case'));
    const input = await savedInput();
    expect(input.completionPolicy).toMatchObject({
      kind: 'remains_return',
      requiresRemainsReturn: true,
      requiredFinalItems: [{ displayStage: 5, index: 5, label: 'Family contacted — ashes ready for pickup' }],
      manualCompletion: { allowed: true, permission: 'case.update' },
      archiveEligibility: 'manual',
    });
  });

  it('an unmodified copy explains why it cannot be approved', async () => {
    // A hand-made copy of Direct Cremation (not built from the shared
    // foundation, which may legitimately match it).
    const direct = byCode('DIRECT_CREMATION');
    const latest = direct.versions[direct.versions.length - 1];
    const copy: WorkflowTemplate = {
      ...structuredClone(direct),
      id: 'workflow-template-fictional-copy',
      name: 'Fictional copied service',
      serviceTypeCodes: [],
      versions: [{ ...structuredClone(latest), version: 1, status: 'draft', composition: undefined, derivedFrom: { templateId: direct.id, version: latest.version } }],
    };
    await renderEditor(GUS, copy);
    const problems = await screen.findByTestId('workflow-version-problems-1');
    await waitFor(() => expect(problems).toHaveTextContent('This workflow is still an unmodified copy of Direct Cremation'));
    expect(screen.getByRole('button', { name: 'Approve version 1' })).toBeDisabled();
  });
});

describe('WorkflowEditor — Manors unchanged', () => {
  it('has no Completion section and saves no completion policy', async () => {
    const manors = structuredClone(standardCremationWorkflowTemplateFixture);
    vi.mocked(workflowTemplatesService.createVersion).mockResolvedValue(manors);
    await renderEditor('managed-cremations', manors);
    expect(screen.queryByTestId('workflow-completion-section')).toBeNull();
    fireEvent.change(screen.getByLabelText('Stage 2 name'), { target: { value: 'Example renamed stage' } });
    const input = await savedInput();
    expect('completionPolicy' in input).toBe(false);
    // Manors keeps its editor: no structure controls, no preview, no approval.
    expect(screen.queryByRole('button', { name: 'Preview workflow' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add stage/i })).toBeNull();
  });
});
