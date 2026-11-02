import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewCaseModal } from './NewCaseModal';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { SessionProvider } from '@/hooks/useSession';
import { workflowTemplateFixtures } from '@/services/__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from '@/services/__mocks__/pricingFixtures';
import { GUS_ADMIN_STAFF_ID } from '@/services/__mocks__/gusFixtures';

/**
 * Service-specific workflows (2026-10). New Case for Gus Camacho Jr.: the
 * selected service decides the workflow — its stages are previewed, and a
 * service whose workflow is still a draft blocks Create with the approval
 * message. Fictional mock data; fetch is a stub.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/caseLogClient', () => ({ createCaseLogEntry: vi.fn(), fetchCaseLog: vi.fn() }));

const GUS = 'gus-camacho-jr';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workflowTemplates: workflowTemplateFixtures.filter((t) => t.organizationId === GUS),
        catalog: serviceCatalogFixtures.filter((item) => item.organizationId === GUS),
      }),
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderModal() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationProvider organizationId={GUS}>
        <SessionProvider value={{ staffId: GUS_ADMIN_STAFF_ID, displayName: 'Fictional Admin' }}>
          <NewCaseModal open onClose={() => {}} />
        </SessionProvider>
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

const createButton = () => screen.getByRole('button', { name: 'Create case' });

describe('NewCaseModal — Gus service workflows', () => {
  it('requires a service before Create, then previews the selected service’s stages', async () => {
    renderModal();
    expect(await screen.findByTestId('new-case-workflow-blocked')).toHaveTextContent(/Choose a service type/);
    expect(createButton()).toBeDisabled();

    fireEvent.click(await screen.findByLabelText(/^Direct Cremation/));
    const preview = await screen.findByTestId('new-case-workflow-preview');
    const stages = within(preview).getAllByRole('listitem').map((li) => li.textContent);
    expect(stages[0]).toMatch(/^First Call & Payment/);
    expect(stages[1]).toMatch(/^JotForm Application/);
    expect(stages).toHaveLength(7);
    expect(preview).not.toHaveTextContent('Intake & JotForm');
    expect(screen.queryByTestId('new-case-workflow-blocked')).toBeNull();
  });

  it('Cremation with Viewing previews the shared cremation stages (its own steps are still to be defined)', async () => {
    renderModal();
    fireEvent.click(await screen.findByLabelText(/^Cremation with Viewing/));
    const preview = await screen.findByTestId('new-case-workflow-preview');
    expect(within(preview).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.queryByTestId('new-case-workflow-blocked')).toBeNull();
  });

  it('a service whose workflow is a draft shows the approval message and keeps Create disabled', async () => {
    renderModal();
    fireEvent.click(await screen.findByLabelText(/^Direct Entombment/));
    await waitFor(() =>
      expect(screen.getByTestId('new-case-workflow-blocked')).toHaveTextContent(
        'The workflow for Direct Entombment (Embalming Required) has not been approved yet. An administrator must review and approve it in Settings › Workflow Templates before cases can use it.',
      ),
    );
    expect(screen.queryByTestId('new-case-workflow-preview')).toBeNull();
    expect(createButton()).toBeDisabled();
  });
});
