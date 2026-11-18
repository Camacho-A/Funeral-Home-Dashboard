import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FuneralDirectorCredentialsPanel } from './FuneralDirectorCredentialsPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import { GUS_CAMACHO_ORGANIZATION_ID } from '@/domain/organization/organizationProfiles';
import { buildGusCredentialFixtures } from '@/services/__mocks__/gusFixtures';

/** Settings › Funeral Director Credentials (Gus Phase 5G). Fictional people; the API is stubbed. */
vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn(async () => ({ identityId: 'identity-gus-admin', roleKey: 'administrator', permissions: ['organization.manage'] })) };
});

const [directorRecord] = buildGusCredentialFixtures(new Date('2026-11-17T12:00:00.000Z'));
const staff = [
  { staffProfileId: 'staff-gus-admin', identityId: 'identity-gus-admin', displayName: 'Avery Demo', isActive: true, record: null, licenseCheck: { verified: false, problems: ['No funeral director license on file.'], notes: [] } },
  { staffProfileId: 'staff-gus-director', identityId: 'identity-gus-director', displayName: 'Jordan Demo', isActive: true, record: directorRecord, licenseCheck: { verified: true, problems: [], notes: [] } },
];

function renderPanel() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { record: directorRecord } : { staff }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OrganizationProvider organizationId={GUS_CAMACHO_ORGANIZATION_ID}>
        <FuneralDirectorCredentialsPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('FuneralDirectorCredentialsPanel', () => {
  it('shows each person’s license, verification and history', async () => {
    renderPanel();
    const row = await screen.findByTestId('credential-staff-gus-director');
    expect(within(row).getByText('License verified')).toBeTruthy();
    expect(within(row).getByText(/FD-FICTIONAL-0001/)).toBeTruthy();
    expect(within(row).getByText(/Verified .* by Avery Demo/)).toBeTruthy();
    expect(within(row).getByText('History (2)')).toBeTruthy();
  });

  it('offers no actions on your own row', async () => {
    renderPanel();
    const own = await screen.findByTestId('credential-staff-gus-admin');
    await waitFor(() => expect(within(own).getByText(/This is you/)).toBeTruthy());
    expect(within(own).queryAllByRole('button')).toHaveLength(0);
  });

  it('authorizes someone else with the revision it was based on', async () => {
    const fetchMock = renderPanel();
    const row = await screen.findByTestId('credential-staff-gus-director');
    fireEvent.click(within(row).getByRole('button', { name: 'Authorize as Funeral Director' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ organizationId: GUS_CAMACHO_ORGANIZATION_ID, staffProfileId: 'staff-gus-director', expectedRevision: 2, change: { kind: 'grant_authorization' } });
  });
});
