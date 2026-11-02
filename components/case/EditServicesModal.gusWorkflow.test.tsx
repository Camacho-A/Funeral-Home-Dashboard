import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EditServicesModal } from './EditServicesModal';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { workflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID } from '@/services/__mocks__/workflowTemplates';
import type { Case } from '@/types/case';
import type { WorkflowTemplate } from '@/types/workflowTemplate';
import type { ServiceCatalogItem } from '@/types/serviceCatalog';

/**
 * Service-specific workflows (2026-10). Changing a Gus case's service type
 * in Edit Services never changes its workflow silently: Save shows an
 * in-page confirmation (no browser confirm()), "Go back" changes nothing,
 * and only "Confirm workflow change" applies it. Mock data mode, fictional
 * cases; every network call is a stub.
 *
 * Consistent service changes (2026-10): the confirmed change is ONE
 * operation — workflow and case order together — and a service with no
 * price is refused before anything changes (no more "workflow changed,
 * order not saved").
 */

const GUS = 'gus-camacho-jr';
let casesBefore: Case[];
let approvedTemplates: WorkflowTemplate[];
let catalog: ServiceCatalogItem[];

const TARGET_ID = caseFixtures.find((c) => c.organizationId === GUS && c.rawStage === 2)!.id;
function target(): Case {
  return caseFixtures.find((c) => c.id === TARGET_ID)!;
}

function renderModal(onClose = vi.fn()) {
  const orderWrites: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/service-catalog')) {
        return Promise.resolve({ ok: true, json: async () => ({ catalog }) });
      }
      if (url.includes('/api/workflow-templates')) {
        return Promise.resolve({ ok: true, json: async () => ({ workflowTemplates: approvedTemplates }) });
      }
      if (url.includes('/order') && (init?.method === 'POST' || init?.method === 'PATCH')) {
        orderWrites.push(JSON.parse(String(init.body)));
        return Promise.resolve({ ok: true, json: async () => ({ order: null, lineItems: [], auditEntries: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationProvider organizationId={GUS} dataAdapterMode="mock">
        <EditServicesModal caseId={target().id} order={null} lineItems={[]} open onClose={onClose} />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
  return { onClose, orderWrites };
}

beforeEach(() => {
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  casesBefore = structuredClone(caseFixtures);
  // The organization's templates as /api/workflow-templates would serve
  // them after an administrator approved Cremation with Viewing.
  approvedTemplates = structuredClone(workflowTemplateFixtures.filter((t) => t.organizationId === GUS));
  approvedTemplates.find((t) => t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!.versions[0].status = 'approved';
  // Fictional prices, as an administrator would set them.
  catalog = structuredClone(serviceCatalogFixtures);
  for (const item of catalog) {
    if (item.organizationId === GUS && (item.serviceCode === 'DIRECT_CREMATION' || item.serviceCode === 'CREMATION_WITH_VIEWING')) item.defaultPrice = 200_000;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  caseFixtures.splice(0, caseFixtures.length, ...casesBefore);
});

async function chooseViewingAndSave() {
  fireEvent.click(await screen.findByLabelText(/Cremation with Viewing/));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  return screen.findByTestId('workflow-change-confirmation');
}

describe('EditServicesModal — service change requires confirmation (Gus)', () => {
  it('shows what will happen and changes nothing until confirmed; "Go back" cancels', async () => {
    const confirmPrompt = vi.spyOn(window, 'confirm');
    renderModal();
    const panel = await chooseViewingAndSave();
    expect(panel).toHaveTextContent('Direct Cremation');
    expect(panel).toHaveTextContent('Cremation with Viewing');
    expect(panel).toHaveTextContent(/Completed steps kept/);
    expect(panel).toHaveTextContent(/New requirements/);
    expect(screen.getByTestId('workflow-change-stage')).toHaveTextContent(/The case will be at/);
    expect(caseFixtures.find((c) => c.id === target().id)!.workflowTemplateId).toBe(GUS_WORKFLOW_TEMPLATE_ID);

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.queryByTestId('workflow-change-confirmation')).toBeNull();
    expect(caseFixtures).toEqual(casesBefore);
    expect(confirmPrompt).not.toHaveBeenCalled();
  });

  it('"Confirm workflow change" applies the workflow and the order together (history kept)', async () => {
    const { onClose, orderWrites } = renderModal();
    await chooseViewingAndSave();
    expect(orderWrites).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm workflow change' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const stored = caseFixtures.find((c) => c.id === target().id)!;
    expect(stored.workflowSnapshot?.serviceTypeCode).toBe('CREMATION_WITH_VIEWING');
    expect(stored.workflowHistory).toHaveLength(1);
    expect(stored.workflowHistory![0].serviceChangeId).toEqual(stored.lastServiceChangeId);
    expect(orderWrites).toEqual([expect.objectContaining({ selections: expect.objectContaining({ serviceTypeCode: 'CREMATION_WITH_VIEWING' }) })]);
  });

  it('an unpriced service is refused before anything changes — neither workflow nor order', async () => {
    catalog.find((item) => item.organizationId === GUS && item.serviceCode === 'CREMATION_WITH_VIEWING')!.defaultPrice = null;
    const { orderWrites } = renderModal();
    fireEvent.click(await screen.findByLabelText(/Cremation with Viewing/));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/must set it in Settings/)).toHaveAttribute('role', 'alert');
    expect(screen.queryByTestId('workflow-change-confirmation')).toBeNull();
    expect(caseFixtures).toEqual(casesBefore);
    expect(orderWrites).toEqual([]);
  });

  it('a draft service is refused with the approval message and nothing changes', async () => {
    renderModal();
    fireEvent.click(await screen.findByLabelText(/Direct Entombment/));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/has not been approved yet/)).toHaveAttribute('role', 'alert');
    expect(caseFixtures).toEqual(casesBefore);
  });
});

describe('EditServicesModal — coordinated service change in wix mode (Gus)', () => {
  it('previews and confirms through ONE /service-change call (no separate order save); a retried confirm reuses its idempotency key', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let confirmAttempts = 0;
    const preview = {
      unchanged: false,
      from: { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, workflowTemplateVersion: 1, workflowName: 'Direct Cremation', serviceTypeCode: 'DIRECT_CREMATION', stageLabel: 'Intake' },
      to: { workflowTemplateId: 'viewing', workflowTemplateVersion: 1, workflowName: 'Cremation with Viewing', serviceTypeCode: 'CREMATION_WITH_VIEWING', stageLabel: 'Intake' },
      kept: [],
      notCarried: [],
      newRequirements: [],
      movesBackward: false,
    };
    const respond = (status: number, json: unknown) => Promise.resolve({ ok: status < 400, status, json: async () => json });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (init?.method === 'POST' || init?.method === 'PATCH') calls.push({ url, body: JSON.parse(String(init.body)) });
        if (url.includes('/service-catalog')) return respond(200, { catalog });
        if (url.includes('/api/workflow-templates')) return respond(200, { workflowTemplates: approvedTemplates });
        if (url.includes('/service-change')) {
          const body = JSON.parse(String(init!.body));
          if (!body.confirm) return respond(200, { applied: false, preview, order: { unchanged: false, currentOrderId: 'order-1', currentTotal: 200_000, newTotal: 200_000, changes: [] } });
          confirmAttempts += 1;
          return confirmAttempts === 1
            ? respond(503, { error: 'The case could not be saved. Nothing was changed — try again.' })
            : respond(200, { applied: true, preview, case: target() });
        }
        if (url.includes(`/api/cases/${target().id}`)) return respond(200, { case: target() });
        return respond(200, {});
      }),
    );
    const onClose = vi.fn();
    const order = { id: 'order-1', organizationId: GUS, caseId: target().id, status: 'active' as const, subtotal: 200_000, discountTotal: 0, taxTotal: 0, total: 200_000, balanceDue: 200_000, version: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
    const lineItems = [
      { id: 'line-1', organizationId: GUS, caseOrderId: 'order-1', lineKind: 'service' as const, serviceCode: 'DIRECT_CREMATION', description: 'Direct Cremation', quantity: 1, unitPrice: 200_000, lineTotal: 200_000, sortOrder: 0, metadata: { serviceRole: 'service_type' }, createdAt: '2026-10-01T00:00:00.000Z' },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OrganizationProvider organizationId={GUS} dataAdapterMode="wix">
          <EditServicesModal caseId={target().id} order={order} lineItems={lineItems} open onClose={onClose} />
        </OrganizationProvider>
      </QueryClientProvider>,
    );
    await chooseViewingAndSave();
    expect(screen.getByTestId('service-change-order')).toHaveTextContent(/updated in the same step/);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm workflow change' }));
    expect(await screen.findByText(/Nothing was changed — try again/)).toHaveAttribute('role', 'alert');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm workflow change' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const confirms = calls.filter((c) => c.url.includes('/service-change') && c.body.confirm === true);
    expect(confirms).toHaveLength(2);
    expect(confirms[0].body.idempotencyKey).toEqual(expect.any(String));
    expect(confirms[1].body.idempotencyKey).toBe(confirms[0].body.idempotencyKey);
    expect(confirms[0].body).toMatchObject({ expectedOrderId: 'order-1', selections: expect.objectContaining({ serviceTypeCode: 'CREMATION_WITH_VIEWING' }) });
    expect(calls.filter((c) => c.url.includes('/order'))).toEqual([]);
    expect(calls.filter((c) => c.url.endsWith('/workflow'))).toEqual([]);
  });
});
