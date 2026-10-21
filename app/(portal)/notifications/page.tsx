'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrganization } from '@/hooks/useOrganization';
import {
  useNotificationInbox,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/hooks/useNotifications';
import { NOTIFICATION_CATEGORY_LABEL } from '@/domain/notifications/notificationTypeRegistry';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import styles from './page.module.css';

/**
 * Notification Center (2026-10).
 *
 * A full-page view of the SAME inbox the TopBar bell opens — the existing
 * `listForRecipient` read, the existing recipient rows, no second store.
 * The drawer stays exactly as it is for a glance; this is for working
 * through a backlog, which a 380px drawer is a poor place to do.
 *
 * Every tab is a filter on the one keyset-paginated query, so "load more"
 * reaches past any page-size ceiling rather than the browser holding the
 * whole inbox. Organization scoping is not done here: the API derives the
 * identity and organization from the session, so this page cannot ask for
 * another tenant's notifications.
 */
type InboxTab = 'all' | 'unread' | 'attention' | 'read' | 'archived';

/** "Needs Attention" is the subset a person still has to DO something
    about — currently the intake-failure notifications, which are the only
    type that names a specific unresolved task. Driven by category, not a
    hardcoded list of ids, so a future actionable type joins by being in
    the same category rather than by editing this file. */
const ATTENTION_CATEGORIES = new Set(['case']);

const TAB_LABEL: Record<InboxTab, string> = {
  all: 'All',
  unread: 'Unread',
  attention: 'Needs Attention',
  read: 'Read',
  archived: 'Archived',
};

export default function NotificationsPage() {
  const { organizationId } = useOrganization();
  const [tab, setTab] = useState<InboxTab>('all');

  // 'unread' is pushed down to the query so the server does the filtering;
  // the other tabs refine the same page client-side, which keeps one
  // cached query rather than four.
  // 'archived' asks the server for archived rows too, then keeps only those.
  // Reading a notification archives it (2026-10), so this is the history.
  const inbox = useNotificationInbox(organizationId, { unreadOnly: tab === 'unread', includeArchived: tab === 'archived' });
  const markRead = useMarkNotificationRead(organizationId);
  const router = useRouter();
  const markAllRead = useMarkAllNotificationsRead(organizationId);

  const items = (inbox.data?.pages ?? []).flatMap((page) => page.items);
  const visible = items.filter(({ notification, recipient }) => {
    if (tab === 'archived') return recipient.archivedAt !== null;
    if (tab === 'read') return recipient.readAt !== null;
    if (tab === 'attention') return recipient.readAt === null && ATTENTION_CATEGORIES.has(notification.category);
    return true;
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Notifications</h1>
        <button
          type="button"
          className={styles.markAllButton}
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending}
        >
          {markAllRead.isPending ? 'Marking…' : 'Mark all as read'}
        </button>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Notification filters">
        {(Object.keys(TAB_LABEL) as InboxTab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={styles.tab}
            onClick={() => setTab(key)}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>

      {tab === 'archived' && <p className={styles.loading}>Notifications move here as soon as you read them.</p>}

      {inbox.isPending ? (
        <p className={styles.loading}>Loading notifications…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          message={tab === 'all' ? 'No notifications yet' : `Nothing in ${TAB_LABEL[tab]}`}
          helperText={
            tab === 'all'
              ? 'When something needs your attention, it will appear here.'
              : 'Try another filter to see more.'
          }
        />
      ) : (
        <ul className={styles.list}>
          {visible.map(({ notification, recipient }) => {
            const isUnread = recipient.readAt === null;
            const categoryLabel =
              NOTIFICATION_CATEGORY_LABEL[notification.category as keyof typeof NOTIFICATION_CATEGORY_LABEL] ??
              notification.category;
            return (
              <li key={recipient.id} className={styles.row} data-unread={isUnread || undefined}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTop}>
                    <span className={styles.rowTitle}>{notification.title}</span>
                    <span className={styles.rowCategory}>{categoryLabel}</span>
                  </div>
                  <p className={styles.rowBody}>{notification.body}</p>
                  <div className={styles.rowMeta}>{formatTimestamp(notification.createdAt)}</div>
                </div>
                <div className={styles.rowActions}>
                  {notification.actionUrl && (
                    <Link
                      className={styles.openLink}
                      href={notification.actionUrl}
                      onClick={(event) => {
                        // Open the item first, then read (= archive) the notification.
                        event.preventDefault();
                        router.push(notification.actionUrl!);
                        if (recipient.archivedAt === null) markRead.mutate(recipient.id);
                      }}
                    >
                      Open
                    </Link>
                  )}
                  {/* One action: reading archives it — no separate Archive. */}
                  {recipient.archivedAt === null && (
                    <button type="button" className={styles.rowButton} onClick={() => markRead.mutate(recipient.id)}>
                      Mark as read
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {inbox.hasNextPage && (
        <button
          type="button"
          className={styles.loadMore}
          onClick={() => inbox.fetchNextPage()}
          disabled={inbox.isFetchingNextPage}
        >
          {inbox.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
