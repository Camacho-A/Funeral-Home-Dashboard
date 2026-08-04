import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationPreferencesPanel } from './NotificationPreferencesPanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as notificationsClient from '@/lib/notificationsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { DEFAULT_NOTIFICATION_PREFERENCE } from '@/types/notificationPreference';

vi.mock('@/lib/notificationsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notificationsClient')>('@/lib/notificationsClient');
  return { ...actual, fetchNotificationPreferences: vi.fn(), updateNotificationPreferences: vi.fn() };
});

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
  it('renders both channels reflecting the current preferences', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue({
      id: `${DEFAULT_ORGANIZATION_ID}-identity-1`,
      organizationId: DEFAULT_ORGANIZATION_ID,
      identityId: 'identity-1',
      updatedAt: '2026-08-04T00:00:00.000Z',
      ...DEFAULT_NOTIFICATION_PREFERENCE,
    });
    renderPanel();
    expect(await screen.findByLabelText('In-app notifications')).toBeChecked();
    expect(screen.getByLabelText('Email notifications')).toBeChecked();
  });

  it('reflects a disabled channel as unchecked', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue({
      id: `${DEFAULT_ORGANIZATION_ID}-identity-1`,
      organizationId: DEFAULT_ORGANIZATION_ID,
      identityId: 'identity-1',
      updatedAt: '2026-08-04T00:00:00.000Z',
      ...DEFAULT_NOTIFICATION_PREFERENCE,
      emailEnabled: false,
    });
    renderPanel();
    expect(await screen.findByLabelText('Email notifications')).not.toBeChecked();
    expect(screen.getByLabelText('In-app notifications')).toBeChecked();
  });

  it('calls updateNotificationPreferences with only the toggled field when a checkbox is unchecked', async () => {
    vi.mocked(notificationsClient.fetchNotificationPreferences).mockResolvedValue({
      id: `${DEFAULT_ORGANIZATION_ID}-identity-1`,
      organizationId: DEFAULT_ORGANIZATION_ID,
      identityId: 'identity-1',
      updatedAt: '2026-08-04T00:00:00.000Z',
      ...DEFAULT_NOTIFICATION_PREFERENCE,
    });
    vi.mocked(notificationsClient.updateNotificationPreferences).mockResolvedValue({
      id: `${DEFAULT_ORGANIZATION_ID}-identity-1`,
      organizationId: DEFAULT_ORGANIZATION_ID,
      identityId: 'identity-1',
      updatedAt: '2026-08-04T00:00:00.000Z',
      ...DEFAULT_NOTIFICATION_PREFERENCE,
      emailEnabled: false,
    });
    renderPanel();
    fireEvent.click(await screen.findByLabelText('Email notifications'));
    await waitFor(() => expect(notificationsClient.updateNotificationPreferences).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, { emailEnabled: false }));
  });
});
