import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationPreferencesPanel } from './NotificationPreferencesPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as notificationsClient from '@/lib/notificationsClient';
import * as identityProfileClient from '@/lib/identityProfileClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { DEFAULT_NOTIFICATION_PREFERENCE, type NotificationPreference } from '@/types/notificationPreference';

vi.mock('@/lib/notificationsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notificationsClient')>('@/lib/notificationsClient');
  return { ...actual, fetchNotificationPreferences: vi.fn(), updateNotificationPreferences: vi.fn() };
});

vi.mock('@/lib/identityProfileClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityProfileClient')>('@/lib/identityProfileClient');
  return { ...actual, fetchMyIdentityProfile: vi.fn() };
});

function basePreference(overrides: Partial<NotificationPreference> = {}): NotificationPreference {
  return {
    id: `${DEFAULT_ORGANIZATION_ID}-identity-1`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    identityId: 'identity-1',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...DEFAULT_NOTIFICATION_PREFERENCE,
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <NotificationPreferencesPanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationPreferencesPanel', () => {
  it('renders in-app/email/sms channels reflecting the current preferences', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue(basePreference());
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    renderPanel();
    expect(await screen.findByLabelText('In-app notifications')).toBeChecked();
    expect(screen.getByLabelText('Email notifications')).toBeChecked();
    expect(screen.getByLabelText('SMS notifications')).not.toBeChecked();
  });

  it('reflects a disabled channel as unchecked', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue(basePreference({ emailEnabled: false }));
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    renderPanel();
    expect(await screen.findByLabelText('Email notifications')).not.toBeChecked();
    expect(screen.getByLabelText('In-app notifications')).toBeChecked();
  });

  it('calls updateNotificationPreferences with only the toggled field when a checkbox is unchecked', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue(basePreference());
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    vi.mocked(notificationsClient.updateNotificationPreferences).mockResolvedValue(basePreference({ emailEnabled: false }));
    renderPanel();
    fireEvent.click(await screen.findByLabelText('Email notifications'));
    await waitFor(() => expect(notificationsClient.updateNotificationPreferences).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, { emailEnabled: false }));
  });

  it('shows a hint to add a phone number when SMS is enabled but no phone is on file', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue(basePreference({ smsEnabled: true }));
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    renderPanel();
    expect(await screen.findByText(/add a phone number/i)).toBeInTheDocument();
  });

  it('does not show the phone hint when a phone number is already on file', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue(basePreference({ smsEnabled: true }));
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue({
      id: 'identity-1',
      email: 'x@example.com',
      normalizedEmail: 'x@example.com',
      displayName: 'X',
      phone: '+15555550100',
      status: 'active',
      emailVerified: true,
      passwordVersion: 1,
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    renderPanel();
    await screen.findByLabelText('SMS notifications');
    expect(screen.queryByText(/add a phone number/i)).not.toBeInTheDocument();
  });

  it('updates digestFrequency via the select', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue(basePreference());
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    vi.mocked(notificationsClient.updateNotificationPreferences).mockResolvedValue(basePreference({ digestFrequency: 'daily' }));
    renderPanel();
    const select = await screen.findByLabelText('Digest frequency');
    fireEvent.change(select, { target: { value: 'daily' } });
    await waitFor(() => expect(notificationsClient.updateNotificationPreferences).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, { digestFrequency: 'daily' }));
  });

  it('updates quiet hours via the time inputs', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue(basePreference());
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    vi.mocked(notificationsClient.updateNotificationPreferences).mockResolvedValue(basePreference({ quietHoursStart: '22:00' }));
    renderPanel();
    const startInput = await screen.findByLabelText('Quiet hours start');
    fireEvent.change(startInput, { target: { value: '22:00' } });
    await waitFor(() => expect(notificationsClient.updateNotificationPreferences).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, { quietHoursStart: '22:00' }));
  });

  it('enabling a category override sends the default override shape for that category', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue(basePreference());
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    vi.mocked(notificationsClient.updateNotificationPreferences).mockResolvedValue(basePreference());
    renderPanel();
    const overrideCheckbox = await screen.findByLabelText('Override Tasks');
    fireEvent.click(overrideCheckbox);
    await waitFor(() =>
      expect(notificationsClient.updateNotificationPreferences).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, {
        categoryOverrides: { task: { emailEnabled: true, inAppEnabled: true, smsEnabled: false } },
      }),
    );
  });

  it('disabling an existing category override removes it from the map entirely', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue(
      basePreference({ categoryOverrides: { task: { emailEnabled: false, inAppEnabled: true, smsEnabled: true } } }),
    );
    vi.mocked(identityProfileClient.fetchMyIdentityProfile).mockResolvedValue(null);
    vi.mocked(notificationsClient.updateNotificationPreferences).mockResolvedValue(basePreference());
    renderPanel();
    const overrideCheckbox = await screen.findByLabelText('Override Tasks');
    expect(overrideCheckbox).toBeChecked();
    fireEvent.click(overrideCheckbox);
    await waitFor(() => expect(notificationsClient.updateNotificationPreferences).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, { categoryOverrides: {} }));
  });
});
