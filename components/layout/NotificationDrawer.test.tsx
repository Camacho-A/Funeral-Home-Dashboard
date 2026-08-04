import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationDrawer } from './NotificationDrawer';
import * as notificationsClient from '@/lib/notificationsClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { Notification } from '@/types/notification';
import type { NotificationRecipient } from '@/types/notificationRecipient';

vi.mock('@/lib/notificationsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notificationsClient')>('@/lib/notificationsClient');
  return {
    ...actual,
    fetchNotificationInbox: vi.fn(),
    markNotificationRead: vi.fn(),
    archiveNotification: vi.fn(),
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

  it('shows "Mark read" only for an unread item, never for an already-read one', async () => {
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
    expect(screen.getAllByRole('button', { name: 'Mark read' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Archive' })).toHaveLength(2);
  });

  it('calls markNotificationRead with the recipient id when "Mark read" is clicked', async () => {
    const { recipient } = makeItem();
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [makeItem()], nextCursor: null });
    vi.mocked(notificationsClient.markNotificationRead).mockResolvedValue({ ...recipient, readAt: '2026-08-04T13:00:00.000Z' });
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark read' }));
    await waitFor(() => expect(notificationsClient.markNotificationRead).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, recipient.id));
  });

  it('calls archiveNotification with the recipient id when "Archive" is clicked', async () => {
    const { recipient } = makeItem();
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [makeItem()], nextCursor: null });
    vi.mocked(notificationsClient.archiveNotification).mockResolvedValue({ ...recipient, archivedAt: '2026-08-04T13:00:00.000Z' });
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(notificationsClient.archiveNotification).toHaveBeenCalledWith(DEFAULT_ORGANIZATION_ID, recipient.id));
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

  it('closes on Escape', async () => {
    vi.mocked(notificationsClient.fetchNotificationInbox).mockResolvedValue({ items: [], nextCursor: null });
    const { onClose } = renderDrawer();
    await screen.findByText('No notifications yet.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
