'use client';

import { useEffect, useRef } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useNotificationInbox, useMarkNotificationRead, useArchiveNotification } from '@/hooks/useNotifications';
import { NOTIFICATION_CATEGORY_LABEL } from '@/domain/notifications/notificationTypeRegistry';
import { formatTimestamp } from '@/utils/format';

/**
 * Phase 28 (Communications & Notifications). The notification center —
 * the caller's own inbox only (`useNotificationInbox` scopes to the
 * current identity server-side; no permission check, matching ADR-032's
 * "no permission needed for your own inbox"). Reading an unread
 * notification marks it read; archiving removes it from view (never
 * deletes the underlying row — see `services/notificationService.ts`).
 *
 * SOLIS Final Phase §2 (2026-10): structural change — a fixed `.sx-notif`
 * panel (role="dialog") replacing the shared `<Modal>`, since the design
 * anchors this top-right under the bell rather than centering it like a
 * true modal. Escape still closes it; focus now moves to the panel's own
 * Close button on open (Modal previously handled this). Every hook,
 * mutation, and the Preferences/View/Mark read/Archive/Load more wiring
 * below is unchanged — only the markup and focus/escape handling, now
 * owned directly by this component instead of by `<Modal>`, changed.
 */
export function NotificationDrawer({ open, onClose, organizationId }: { open: boolean; onClose: () => void; organizationId: string }) {
  const inbox = useNotificationInbox(organizationId, {}, open);
  const markRead = useMarkNotificationRead(organizationId);
  const archive = useArchiveNotification(organizationId);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onMouseDown={onClose} aria-hidden="true" />
      <div className="sx-notif" role="dialog" aria-modal="true" aria-labelledby="notif-title" ref={panelRef}>
        <div className="sx-notif-header">
          <h2 id="notif-title" className="sx-notif-title">
            Notifications
          </h2>
          <div style={{ display: 'flex', gap: 2 }}>
            <a href="/settings/notifications" className="sx-btn sx-btn-ghost sx-btn-sm">
              Preferences
            </a>
            <button type="button" className="sx-icon-btn" aria-label="Close notifications" onClick={onClose} ref={closeButtonRef}>
              ×
            </button>
          </div>
        </div>

        <div className="sx-notif-list">
          {inbox.isPending && (
            <div className="sx-loading" aria-busy="true">
              <span className="sx-skeleton" style={{ width: '90%' }} />
              <span className="sx-skeleton" style={{ width: '70%' }} />
              <span className="sx-skeleton" style={{ width: '80%' }} />
              <span className="sr-only">Loading notifications…</span>
            </div>
          )}
          {inbox.isError && <div className="sx-error-state" role="alert">Couldn&rsquo;t load notifications. Please try again.</div>}

          {!inbox.isPending && !inbox.isError && items.length === 0 && (
            <EmptyState message="No notifications yet." helperText="You'll see updates here when something needs you." center />
          )}

          {items.map(({ notification, recipient }) => {
            const isUnread = recipient.readAt === null;
            const categoryLabel = NOTIFICATION_CATEGORY_LABEL[notification.category as keyof typeof NOTIFICATION_CATEGORY_LABEL] ?? notification.category;
            return (
              <div key={recipient.id} className="sx-notif-row" data-unread={isUnread || undefined}>
                <span className="sx-notif-dot" aria-hidden="true" />
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span className="sx-notif-row-title">
                      {isUnread && <span className="sr-only">Unread</span>}
                      {notification.title}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--sx-faint)', whiteSpace: 'nowrap' }}>{categoryLabel}</span>
                  </div>
                  <p className="sx-notif-body">{notification.body}</p>
                  <div className="sx-notif-meta">
                    <span style={{ marginRight: 4 }}>{formatTimestamp(notification.createdAt)}</span>
                    {notification.actionUrl && (
                      <a href={notification.actionUrl} className="sx-btn sx-btn-ghost" style={{ color: 'var(--sx-link)' }}>
                        View
                      </a>
                    )}
                    {isUnread && (
                      <button type="button" className="sx-btn sx-btn-ghost" onClick={() => markRead.mutate(recipient.id)} disabled={markRead.isPending}>
                        Mark read
                      </button>
                    )}
                    <button type="button" className="sx-btn sx-btn-ghost" onClick={() => archive.mutate(recipient.id)} disabled={archive.isPending}>
                      Archive
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {inbox.hasNextPage && (
          <div className="sx-notif-footer">
            <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => inbox.fetchNextPage()} disabled={inbox.isFetchingNextPage}>
              {inbox.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
