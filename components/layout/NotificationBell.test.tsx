import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationBell } from './NotificationBell';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as notificationsClient from '@/lib/notificationsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Notification } from '@/types/notification';
import type { NotificationRecipient } from '@/types/notificationRecipient';

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }));


vi.mock('@/lib/notificationsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notificationsClient')>('@/lib/notificationsClient');
  return {
    ...actual,
    fetchUnreadNotificationCount: vi.fn(),
    fetchNotificationInbox: vi.fn(),
    markNotificationRead: vi.fn(),
    archiveNotification: vi.fn(),
    markAllNotificationsRead: vi.fn(),
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

  it('shows the unread badge as a red alert, not the brand navy', async () => {
    vi.mocked(notificationsClient.fetchUnreadNotificationCount).mockResolvedValue(2);
    renderBell();
    const badge = await screen.findByText('2');
    expect(badge).toHaveAttribute('data-tone', 'alert');
    expect(badge.className).toMatch(/danger/);
    const css = (await import('fs')).readFileSync('components/layout/NotificationBell.module.css', 'utf8');
    expect(css).toMatch(/\.countBadge\s*{[^}]*background:\s*var\(--sx-red\)/);
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
    expect(within(dialog).getByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
  });
});

describe('NotificationBell — read means archived, and the badge moves at once (2026-10)', () => {
  it('clicking the bell reads nothing', async () => {
    vi.mocked(notificationsClient.fetchUnreadNotificationCount).mockResolvedValue(1);
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({
      items: [{ notification: makeNotification(), recipient: makeRecipient() }],
      nextCursor: null,
    });
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1 unread)' }));
    await within(await screen.findByRole('dialog')).findByText('Task assigned');
    expect(notificationsClient.markNotificationRead).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Notifications (1 unread)' })).toBeInTheDocument();
  });

  it('marking one read drops the badge immediately, before the server answers', async () => {
    vi.mocked(notificationsClient.fetchUnreadNotificationCount).mockResolvedValue(2);
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({
      items: [{ notification: makeNotification(), recipient: makeRecipient() }],
      nextCursor: null,
    });
    vi.mocked(notificationsClient.markNotificationRead).mockReturnValue(new Promise(() => {}) as never);
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (2 unread)' }));
    fireEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Mark as read' }));
    expect(await screen.findByRole('button', { name: 'Notifications (1 unread)' })).toBeInTheDocument();
  });

  it('restores the badge if the server refuses', async () => {
    vi.mocked(notificationsClient.fetchUnreadNotificationCount).mockResolvedValue(2);
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({
      items: [{ notification: makeNotification(), recipient: makeRecipient() }],
      nextCursor: null,
    });
    vi.mocked(notificationsClient.markNotificationRead).mockRejectedValue(new Error('nope'));
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (2 unread)' }));
    fireEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Mark as read' }));
    expect(await screen.findByRole('button', { name: 'Notifications (2 unread)' })).toBeInTheDocument();
  });
});

describe('NotificationBell — Mark all as read (2026-10)', () => {
  it('zeroes the badge and empties the panel at once, with one request and no per-item reads', async () => {
    vi.mocked(notificationsClient.fetchUnreadNotificationCount).mockResolvedValue(3);
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({
      items: [
        { notification: makeNotification(), recipient: makeRecipient() },
        { notification: makeNotification({ id: 'notif-2', title: 'Second' }), recipient: makeRecipient({ id: 'r-2', notificationId: 'notif-2' }) },
      ],
      nextCursor: null,
    });
    vi.mocked(notificationsClient.markAllNotificationsRead).mockReturnValue(new Promise(() => {}));
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (3 unread)' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Second');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark all as read' }));
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(within(dialog).queryByText('Task assigned')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Second')).not.toBeInTheDocument();
    expect(notificationsClient.markAllNotificationsRead).toHaveBeenCalledTimes(1);
    expect(notificationsClient.markNotificationRead).not.toHaveBeenCalled();
  });

  it('restores the badge and the list if the server refuses', async () => {
    vi.mocked(notificationsClient.fetchUnreadNotificationCount).mockResolvedValue(1);
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({
      items: [{ notification: makeNotification(), recipient: makeRecipient() }],
      nextCursor: null,
    });
    vi.mocked(notificationsClient.markAllNotificationsRead).mockRejectedValue(new Error('nope'));
    renderBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1 unread)' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Mark all as read' }));
    expect(await screen.findByRole('button', { name: 'Notifications (1 unread)' })).toBeInTheDocument();
    expect(await within(dialog).findByText('Task assigned')).toBeInTheDocument();
  });
});
