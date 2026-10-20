import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NotificationsPage from './page';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as notificationsClient from '@/lib/notificationsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Notification } from '@/types/notification';
import type { NotificationRecipient } from '@/types/notificationRecipient';

vi.mock('@/lib/notificationsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notificationsClient')>('@/lib/notificationsClient');
  return { ...actual, fetchNotificationInbox: vi.fn(), markNotificationRead: vi.fn(), archiveNotification: vi.fn(), markAllNotificationsRead: vi.fn() };
});

function item(id: string, title: string, recipient: Partial<NotificationRecipient>) {
  const notification: Notification = {
    id,
    organizationId: DEFAULT_ORGANIZATION_ID,
    notificationType: 'case.created',
    category: 'case',
    title,
    body: 'body',
    actionUrl: null,
    entityType: 'case',
    entityId: 'case-1',
    recipientScope: 'individual',
    recipientRoleKey: null,
    status: 'active',
    actorIdentityId: null,
    correlationId: 'c',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  };
  return {
    notification,
    recipient: {
      id: `${id}-r`,
      organizationId: DEFAULT_ORGANIZATION_ID,
      notificationId: id,
      identityId: 'identity-1',
      readAt: null,
      archivedAt: null,
      createdAt: '2026-10-01T12:00:00.000Z',
      ...recipient,
    } as NotificationRecipient,
  };
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <NotificationsPage />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('Notifications page — Archived tab (2026-10)', () => {
  it('asks for archived rows and shows only archived ones, including those read over a week ago', async () => {
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({
      items: [
        item('n1', 'Archived by hand', { readAt: '2026-10-01T13:00:00.000Z', archivedAt: '2026-10-01T13:00:00.000Z' }),
        item('n2', 'Read long ago', { readAt: '2020-01-01T00:00:00.000Z' }),
        item('n3', 'Still unread', {}),
      ],
      nextCursor: null,
    });
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: 'Archived' }));

    await waitFor(() =>
      expect(notificationsClient.fetchNotificationInbox).toHaveBeenCalledWith(
        DEFAULT_ORGANIZATION_ID,
        expect.objectContaining({ includeArchived: true }),
        null,
      ),
    );
    expect(await screen.findByText('Archived by hand')).toBeInTheDocument();
    expect(screen.getByText('Read long ago')).toBeInTheDocument();
    expect(screen.queryByText('Still unread')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.getByText(/move here by themselves 7 days after you read them/)).toBeInTheDocument();
  });
});
