import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationBell } from './NotificationBell';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as notificationsClient from '@/lib/notificationsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Notification } from '@/types/notification';
import type { NotificationRecipient } from '@/types/notificationRecipient';

vi.mock('@/lib/notificationsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notificationsClient')>('@/lib/notificationsClient');
  return {
    ...actual,
    fetchUnreadNotificationCount: vi.fn(),
    fetchNotificationInbox: vi.fn(),
    markNotificationRead: vi.fn(),
    archiveNotification: vi.fn(),
  };
});

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    notificationType: 'task.assigned',
    category: 'task',
    title: 'Task assigned',
    body: 'Dana assigned you: "Call the cemetery"',
    actionUrl: null,
    entityType: null,
    entityId: null,
    recipientScope: 'individual',
    recipientRoleKey: null,
    status: 'active',
    actorIdentityId: 'identity-1',
    correlationId: 'corr-1',
    createdAt: '2026-08-04T12:00:00.000Z',
    updatedAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  };
}

function makeRecipient(overrides: Partial<NotificationRecipient> = {}): NotificationRecipient {
  return {
    id: 'notif-1-identity-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    notificationId: 'notif-1',
    identityId: 'identity-1',
    readAt: null,
    archivedAt: null,
    createdAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  };
}

function renderBell() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <NotificationBell />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationBell', () => {
  it('shows no badge when the unread count is zero', async () => {
    vi.mocked(notificationsClient.fetchUnreadNotificationCount).mockResolvedValue(0);
    renderBell();
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('shows the unread count as a badge and in the accessible name', async () => {
    vi.mocked(notificationsClient.fetchUnreadNotificationCount).mockResolvedValue(3);
    renderBell();
    expect(await screen.findByRole('button', { name: 'Notifications (3 unread)' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('caps the displayed badge at "99+"', async () => {
    vi.mocked(notificationsClient.fetchUnreadNotificationCount).mockResolvedValue(150);
    renderBell();
    expect(await screen.findByText('99+')).toBeInTheDocument();
  });

  it('opens the drawer on click, showing the inbox', async () => {
    vi.mocked(notificationsClient.fetchUnreadNotificationCount).mockResolvedValue(1);
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({
      items: [{ notification: makeNotification(), recipient: makeRecipient() }],
      nextCursor: null,
    });
    renderBell();

    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1 unread)' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Task assigned')).toBeInTheDocument();
    expect(within(dialog).getByText('Dana assigned you: "Call the cemetery"')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Mark read' })).toBeInTheDocument();
  });
});
