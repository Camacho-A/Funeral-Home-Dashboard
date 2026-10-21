import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationDrawer } from './NotificationDrawer';
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
    fetchNotificationInbox: vi.fn(),
    markNotificationRead: vi.fn(),
    archiveNotification: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  };
});

function makeItem(overrides: Partial<Notification> = {}, recipientOverrides: Partial<NotificationRecipient> = {}) {
  const notification: Notification = {
    id: 'notif-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    notificationType: 'signature.completed',
    category: 'signature',
    title: 'Document signed',
    body: 'Cremation Authorization was signed for case B2026-001 (Robert Ellison)',
    actionUrl: '/cases/case-1',
    entityType: 'signatureRequest',
    entityId: 'sig-1',
    recipientScope: 'individual',
    recipientRoleKey: null,
    status: 'active',
    actorIdentityId: null,
    correlationId: 'corr-1',
    createdAt: '2026-08-04T12:00:00.000Z',
    updatedAt: '2026-08-04T12:00:00.000Z',
    ...overrides,
  };
  const recipient: NotificationRecipient = {
    id: `${notification.id}-identity-1`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    notificationId: notification.id,
    identityId: 'identity-1',
    readAt: null,
    archivedAt: null,
    createdAt: '2026-08-04T12:00:00.000Z',
    ...recipientOverrides,
  };
  return { notification, recipient };
}

function renderDrawer(onClose = vi.fn()) {
  const queryClient = new QueryClient();
  return { onClose, ...render(
    <QueryClientProvider client={queryClient}>
      <NotificationDrawer open onClose={onClose} organizationId={DEFAULT_ORGANIZATION_ID} />
    </QueryClientProvider>,
  ) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationDrawer', () => {
  it('shows an empty state when the inbox has no items', async () => {
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [], nextCursor: null });
    renderDrawer();
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
  });

  it('renders each item with title, body, category, and a link to preferences', async () => {
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [makeItem()], nextCursor: null });
    renderDrawer();
    expect(await screen.findByText('Document signed')).toBeInTheDocument();
    expect(screen.getByText('Cremation Authorization was signed for case B2026-001 (Robert Ellison)')).toBeInTheDocument();
    expect(screen.getByText('Signature')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Preferences' })).toHaveAttribute('href', '/settings/notifications');
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/cases/case-1');
  });

  it('offers one "Mark as read" per item — including one read before read meant archived — and no separate Archive', async () => {
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({
      items: [
        makeItem({ id: 'unread-notif', title: 'Unread item' }, { id: 'unread-recipient', readAt: null }),
        makeItem({ id: 'read-notif', title: 'Read item' }, { id: 'read-recipient', readAt: '2026-08-04T13:00:00.000Z' }),
      ],
      nextCursor: null,
    });
    renderDrawer();
    await screen.findByText('Unread item');
    await screen.findByText('Read item');
    expect(screen.getAllByRole('button', { name: 'Mark as read' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('calls markNotificationRead (which archives) with the recipient id when "Mark as read" is clicked', async () => {
    const { recipient } = makeItem();
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [makeItem()], nextCursor: null });
    vi.mocked(notificationsClient.markNotificationRead).mockResolvedValue({ ...recipient, readAt: '2026-08-04T13:00:00.000Z', archivedAt: '2026-08-04T13:00:00.000Z' });
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as read' }));
    await waitFor(() => expect(notificationsClient.markNotificationRead).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, recipient.id));
    expect(notificationsClient.archiveNotification).not.toHaveBeenCalled();
  });

  it('"Mark all as read" in the bell panel clears the whole inbox at once, with one request', async () => {
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({
      items: [
        makeItem({ id: 'a', title: 'First' }, { id: 'a-r' }),
        makeItem({ id: 'b', title: 'Second (read earlier)' }, { id: 'b-r', readAt: '2026-08-04T13:00:00.000Z' }),
      ],
      nextCursor: null,
    });
    let resolve!: (value: { markedRead: number }) => void;
    vi.mocked(notificationsClient.markAllNotificationsRead).mockReturnValue(new Promise((r) => (resolve = r)));
    renderDrawer();
    await screen.findByText('First');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    // Both leave before the server answers — the already-read one too.
    await waitFor(() => expect(screen.queryByText('First')).not.toBeInTheDocument());
    expect(screen.queryByText('Second (read earlier)')).not.toBeInTheDocument();
    expect(notificationsClient.markAllNotificationsRead).toHaveBeenCalledTimes(1);
    expect(notificationsClient.markAllNotificationsRead).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID);
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [], nextCursor: null });
    resolve({ markedRead: 2 });
  });

  it('"Mark all as read" is disabled when the inbox is empty', async () => {
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [], nextCursor: null });
    renderDrawer();
    await screen.findByText('No notifications yet.');
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('loads the next page via cursor when "Load more" is clicked', async () => {
    vi.mocked(notificationsClient.fetchNotificationInbox).mockImplementation(async (_orgId, _filters, cursor) => {
      if (!cursor) return { items: [makeItem({ id: 'first', title: 'First notification' })], nextCursor: 'cursor-2' };
      return { items: [makeItem({ id: 'second', title: 'Second notification' })], nextCursor: null };
    });
    renderDrawer();
    await screen.findByText('First notification');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Second notification')).toBeInTheDocument();
    expect(screen.getByText('First notification')).toBeInTheDocument();
  });

  it('"View" opens the related item first, then reads (and so archives) the notification, and closes the drawer', async () => {
    const { recipient, notification } = makeItem();
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [{ notification, recipient }], nextCursor: null });
    vi.mocked(notificationsClient.markNotificationRead).mockResolvedValue({ ...recipient, readAt: '2026-08-04T13:00:00.000Z', archivedAt: '2026-08-04T13:00:00.000Z' });
    const { onClose } = renderDrawer();

    const view = await screen.findByRole('link', { name: 'View' });
    expect(view).toHaveAttribute('href', '/cases/case-1');
    fireEvent.click(view);

    expect(routerPush).toHaveBeenCalledWith('/cases/case-1');
    await waitFor(() => expect(notificationsClient.markNotificationRead).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, recipient.id));
    expect(routerPush.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(notificationsClient.markNotificationRead).mock.invocationCallOrder[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('opening the drawer alone reads nothing', async () => {
    const { recipient, notification } = makeItem();
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [{ notification, recipient }], nextCursor: null });
    renderDrawer();
    await screen.findByRole('link', { name: 'View' });
    expect(notificationsClient.markNotificationRead).not.toHaveBeenCalled();
    expect(notificationsClient.archiveNotification).not.toHaveBeenCalled();
  });

  it('"Mark as read" removes the notification from the inbox at once', async () => {
    const { recipient, notification } = makeItem();
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [{ notification, recipient }], nextCursor: null });
    let resolve!: (value: unknown) => void;
    vi.mocked(notificationsClient.markNotificationRead).mockReturnValue(new Promise((r) => (resolve = r)) as never);
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as read' }));
    // Gone before the server has answered.
    await waitFor(() => expect(screen.queryByText('Document signed')).not.toBeInTheDocument());
    resolve({ ...recipient, readAt: 'x', archivedAt: 'x' });
  });

  it('closes on Escape', async () => {
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [], nextCursor: null });
    const { onClose } = renderDrawer();
    await screen.findByText('No notifications yet.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
