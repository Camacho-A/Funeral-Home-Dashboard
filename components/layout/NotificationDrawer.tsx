'use client';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useNotificationInbox, useMarkNotificationRead, useArchiveNotification } from '@/hooks/useNotifications';
import { NOTIFICATION_CATEGORY_LABEL } from '@/domain/notifications/notificationTypeRegistry';
import { formatTimestamp } from '@/utils/format';
import styles from './NotificationDrawer.module.css';

/**
 * Phase 28 (Communications & Notifications). The notification center —
 * the caller's own inbox only (`useNotificationInbox` scopes to the
 * current identity server-side; no permission check, matching ADR-032's
 * "no permission needed for your own inbox"). Reading an unread
 * notification marks it read; archiving removes it from view (never
 * deletes the underlying row — see `services/notificationService.ts`).
 */
export function NotificationDrawer({ open, onClose, organizationId }: { open: boolean; onClose: () => void; organizationId: string }) {
  const inbox = useNotificationInbox(organizationId, {}, open);
  const markRead = useMarkNotificationRead(organizationId);
  const archive = useArchiveNotification(organizationId);

  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Notifications">
      <div className={styles.header}>
        <h2 className={styles.title}>Notifications</h2>
        <a href="/settings/notifications" className={styles.preferencesLink}>
          Preferences
        </a>
      </div>

      {inbox.isPending && <p className={styles.loading}>Loading notifications…</p>}
      {inbox.isError && <p className={styles.errorText}>Couldn&rsquo;t load notifications. Please try again.</p>}

      {!inbox.isPending && !inbox.isError && items.length === 0 && <EmptyState message="No notifications yet." />}

      {items.length > 0 && (
        <div className={styles.list}>
          {items.map(({ notification, recipient }) => {
            const isUnread = recipient.readAt === null;
            return (
              <div key={recipient.id} className={isUnread ? styles.entryUnread : styles.entry}>
                <div className={styles.body}>
                  <div className={styles.titleRow}>
                    <span className={styles.notificationTitle}>{notification.title}</span>
                    <span className={styles.categoryLabel}>{NOTIFICATION_CATEGORY_LABEL[notification.category as keyof typeof NOTIFICATION_CATEGORY_LABEL] ?? notification.category}</span>
                  </div>
                  <p className={styles.notificationBody}>{notification.body}</p>
                  <div className={styles.meta}>
                    {formatTimestamp(notification.createdAt)}
                    {notification.actionUrl && (
                      <a href={notification.actionUrl} className={styles.actionLink}>
                        View
                      </a>
                    )}
                  </div>
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
        </div>
      )}

      {inbox.hasNextPage && (
        <Button variant="secondary" onClick={() => inbox.fetchNextPage()} disabled={inbox.isFetchingNextPage}>
          {inbox.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </Modal>
  );
}
