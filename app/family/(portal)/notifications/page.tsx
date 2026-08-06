'use client';

import { useFamilyNotificationInbox, useMarkFamilyNotificationRead, useArchiveFamilyNotification } from '@/hooks/useFamilyNotifications';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/format';
import styles from './page.module.css';

/**
 * Phase 29 (Family Portal & External Collaboration). The caller's own
 * inbox — no capability check beyond a verified session, mirroring the
 * staff `NotificationDrawer`'s own "no permission needed for your own
 * inbox" precedent, rendered as a full page rather than a modal (this
 * surface's own top-level destination, not an overlay on top of
 * something else).
 */
export default function FamilyNotificationsPage() {
  const inbox = useFamilyNotificationInbox();
  const markRead = useMarkFamilyNotificationRead();
  const archive = useArchiveFamilyNotification();

  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Notifications</h1>

      {inbox.isPending && <p className={styles.loading}>Loading notifications…</p>}
      {inbox.isError && <p className={styles.errorText}>Couldn&rsquo;t load notifications. Please try again.</p>}

      {!inbox.isPending && !inbox.isError && items.length === 0 && <EmptyState message="No notifications yet." />}

      {items.length > 0 && (
        <Card className={styles.listCard}>
          {items.map(({ notification, recipient }) => {
            const isUnread = recipient.readAt === null;
            return (
              <div key={recipient.id} className={isUnread ? styles.entryUnread : styles.entry}>
                <div className={styles.body}>
                  <span className={styles.title}>{notification.title}</span>
                  <p className={styles.notificationBody}>{notification.body}</p>
                  <span className={styles.meta}>{formatTimestamp(notification.createdAt)}</span>
                </div>
                <div className={styles.actions}>
                  {isUnread && (
                    <Button variant="secondary" onClick={() => markRead.mutate(recipient.id)} disabled={markRead.isPending}>
                      Mark read
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => archive.mutate(recipient.id)} disabled={archive.isPending}>
                    Archive
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {inbox.hasNextPage && (
        <Button variant="secondary" onClick={() => inbox.fetchNextPage()} disabled={inbox.isFetchingNextPage}>
          {inbox.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
