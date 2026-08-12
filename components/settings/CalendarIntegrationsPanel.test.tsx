import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarIntegrationsPanel } from './CalendarIntegrationsPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as calendarClient from '@/lib/calendarIntegrationsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { CalendarConnection } from '@/types/calendarConnection';
import type { SchedulingReminderPolicy } from '@/types/schedulingReminderPolicy';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/calendarIntegrationsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/calendarIntegrationsClient')>('@/lib/calendarIntegrationsClient');
  return {
    ...actual,
    fetchCalendarConnections: vi.fn(),
    disconnectCalendarConnection: vi.fn(),
    beginCalendarConnect: vi.fn(),
    fetchReminderPolicy: vi.fn(),
    updateReminderPolicy: vi.fn(),
    fetchCalendarFeedTokens: vi.fn(),
    generateCalendarFeedToken: vi.fn(),
    revokeCalendarFeedToken: vi.fn(),
  };
});

const DEFAULT_POLICY: SchedulingReminderPolicy = { organizationId: DEFAULT_ORGANIZATION_ID, leadTimesMinutes: [120, 1440], notifyOwner: true, notifyFamily: false, updatedAt: '2026-09-01T00:00:00.000Z' };

const CONNECTION: CalendarConnection = {
  id: 'conn-1',
  organizationId: DEFAULT_ORGANIZATION_ID,
  staffProfileId: 'staff-dana',
  provider: 'google',
  externalAccountEmail: 'dana@gmail.com',
  externalCalendarId: 'primary',
  status: 'connected',
  scopesGranted: 'calendar.events',
  accessTokenCiphertext: 'ct',
  refreshTokenCiphertext: 'ct',
  tokenExpiresAt: '2026-09-01T01:00:00.000Z',
  connectedAt: '2026-09-01T00:00:00.000Z',
  disconnectedAt: null,
  lastSyncAt: null,
  lastErrorAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function renderPanel(permissions: string[] = ['calendar.manage']) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
  vi.mocked(calendarClient.fetchCalendarConnections).mockResolvedValue([CONNECTION]);
  vi.mocked(calendarClient.fetchReminderPolicy).mockResolvedValue(DEFAULT_POLICY);
  vi.mocked(calendarClient.fetchCalendarFeedTokens).mockResolvedValue([]);

  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <CalendarIntegrationsPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('CalendarIntegrationsPanel', () => {
  it('renders the connected account and its status', async () => {
    renderPanel();
    expect(await screen.findByText(/dana@gmail.com/)).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('starts the Google OAuth flow and navigates to the returned authorize URL', async () => {
    renderPanel();
    vi.mocked(calendarClient.beginCalendarConnect).mockResolvedValue('https://accounts.google.com/authorize?state=abc');

    const originalLocation = window.location;
    const assignSpy = vi.fn();
    // @ts-expect-error — redefining window.location for a navigation assertion, standard JSDOM pattern
    delete window.location;
    // @ts-expect-error — partial Location stand-in, only `assign` is exercised
    window.location = { assign: assignSpy };

    await screen.findByText(/dana@gmail.com/);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Google Calendar' }));

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('https://accounts.google.com/authorize?state=abc'));

    // @ts-expect-error — restoring the real window.location after the test
    window.location = originalLocation;
  });

  it('disables reminder-policy controls for a caller without calendar.manage', async () => {
    renderPanel([]);
    const checkbox = await screen.findByLabelText('Notify the appointment owner');
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/Only an administrator or manager can change these settings/)).toBeInTheDocument();
  });

  it('enables reminder-policy controls and toggles notifyOwner for a caller with calendar.manage', async () => {
    renderPanel(['calendar.manage']);
    vi.mocked(calendarClient.updateReminderPolicy).mockResolvedValue({ ...DEFAULT_POLICY, notifyOwner: false });

    const checkbox = await screen.findByLabelText('Notify the appointment owner');
    expect(checkbox).not.toBeDisabled();
    fireEvent.click(checkbox);

    await waitFor(() => expect(calendarClient.updateReminderPolicy).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, { notifyOwner: false }));
  });

  it('generates a feed token and shows the raw link exactly once', async () => {
    renderPanel();
    vi.mocked(calendarClient.generateCalendarFeedToken).mockResolvedValue({
      token: { id: 'token-1', organizationId: DEFAULT_ORGANIZATION_ID, tokenHash: 'hash', scope: 'staff_own', ownerStaffProfileId: 'staff-dana', createdAt: '2026-09-01T00:00:00.000Z', revokedAt: null, lastAccessedAt: null },
      rawToken: 'raw-token-value',
    });

    await screen.findByText(/dana@gmail.com/);
    fireEvent.click(screen.getByRole('button', { name: 'Generate new feed link' }));

    expect(await screen.findByText(/raw-token-value/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(/raw-token-value/)).not.toBeInTheDocument();
  });
});
