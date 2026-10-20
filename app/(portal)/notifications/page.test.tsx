import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NotificationsPage from './page';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as notificationsClient from '@/lib/notificationsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Notification } from '@/types/notification';
import type { NotificationRecipient } from '@/types/notificationRecipient';

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }));


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

describe('Notifications page — read means archived (2026-10)', () => {
  it('the Archived tab asks for archived rows and shows exactly the archived ones', async () => {
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({
      items: [
        item('n1', 'Read and archived', { readAt: '2026-10-01T13:00:00.000Z', archivedAt: '2026-10-01T13:00:00.000Z' }),
        item('n3', 'Still unread', {}),
      ],
      nextCursor: null,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Archived' }));
    await waitFor(() =>
      expect(notificationsClient.fetchNotificationInbox).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, expect.objectContaining({ includeArchived: true }), null),
    );
    expect(await screen.findByText('Read and archived')).toBeInTheDocument();
    expect(screen.queryByText('Still unread')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.getByText('Notifications move here as soon as you read them.')).toBeInTheDocument();
  });

  it('"Open" goes to the item first, then reads (and so archives) the notification', async () => {
    const n = item('n1', 'Case created', {});
    n.notification.actionUrl = '/cases/case-1';
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [n], nextCursor: null });
    vi.mocked(notificationsClient.markNotificationRead).mockResolvedValue({ ...n.recipient, readAt: 'x', archivedAt: 'x' });
    renderPage();
    fireEvent.click(await screen.findByRole('link', { name: 'Open' }));
    expect(routerPush).toHaveBeenCalledWith('/cases/case-1');
    await waitFor(() => expect(notificationsClient.markNotificationRead).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, 'n1-r'));
    expect(routerPush.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(notificationsClient.markNotificationRead).mock.invocationCallOrder[0]);
  });
});
