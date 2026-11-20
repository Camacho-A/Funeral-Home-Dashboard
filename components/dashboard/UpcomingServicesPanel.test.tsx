import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UpcomingServicesPanel } from './UpcomingServicesPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } from '@/domain/organization/organizationProfiles';

/** Upcoming services panel (Gus Phase 5L). Fictional rows; the route is stubbed. */
const row = (overrides: Record<string, unknown> = {}) => ({
  caseId: 'gus-case-010',
  caseNumber: 'G2026-010',
  decedentName: 'Fictional Person',
  serviceName: 'Viewing',
  startAt: '2026-12-10T15:00:00.000Z',
  endAt: '2026-12-10T17:00:00.000Z',
  status: 'scheduled',
  completed: 3,
  total: 12,
  overdue: 0,
  blocking: 9,
  ready: false,
  awaitingRelease: true,
  released: false,
  ...overrides,
});

function renderPanel(organizationId: string, services: unknown[]) {
  const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ services }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['organization', organizationId], { id: organizationId, name: 'Fictional', isActive: true, timezone: 'America/New_York' });
  render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={organizationId}>
        <UpcomingServicesPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('UpcomingServicesPanel', () => {
  it('lists each service with its progress and state, linking to the case', async () => {
    renderPanel(GUS_CAMACHO_ORGANIZATION_ID, [row(), row({ caseId: 'b', caseNumber: 'G2026-011', overdue: 2 }), row({ caseId: 'c', caseNumber: 'G2026-012', status: 'completed' })]);
    const panel = await screen.findByTestId('upcoming-services');
    const links = await within(panel).findAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links[0].getAttribute('href')).toBe('/cases/gus-case-010');
    expect(links[0].textContent).toMatch(/Viewing · G2026-010 · 3\/12 prepared/);
    expect(links[0].textContent).toMatch(/9 to do/);
    expect(links[1].textContent).toMatch(/2 overdue/);
    expect(links[2].textContent).toMatch(/Awaiting release/);
  });

  it('says when there is nothing coming up', async () => {
    renderPanel(GUS_CAMACHO_ORGANIZATION_ID, []);
    expect(await screen.findByText(/No Viewing or Final Goodbye in the next two weeks/)).toBeTruthy();
  });

  it('renders nothing, and asks for nothing, for Manors', () => {
    const fetchMock = renderPanel(MANORS_ORGANIZATION_ID, []);
    expect(screen.queryByTestId('upcoming-services')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/service-preparation/upcoming'))).toBe(false);
  });
});
