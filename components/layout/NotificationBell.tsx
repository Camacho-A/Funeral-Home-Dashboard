'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useUnreadNotificationCount } from '@/hooks/useNotifications';
import { Badge } from '@/components/ui/Badge';
import { NotificationDrawer } from './NotificationDrawer';
import styles from './NotificationBell.module.css';

/**
 * Phase 28 (Communications & Notifications). The TopBar trigger for the
 * notification drawer — renders in every auth mode (no `authAdapterMode`
 * gate, unlike Security/Roles/Team/Audit/Templates), since the personal
 * inbox works identically under every `AUTH_ADAPTER` (dual-mode
 * `requireAuthorizedOrganization`, no permission needed — see ADR-032).
 * The unread count is always a live, polled query (`useUnreadNotificationCount`),
 * never a value this component computes or caches itself.
 */
export function NotificationBell() {
  const { organizationId } = useOrganization();
  const [open, setOpen] = useState(false);
  const unreadCount = useUnreadNotificationCount(organizationId);
  const count = unreadCount.data ?? 0;

  return (
    <>
      <button type="button" className={styles.bellButton} onClick={() => setOpen(true)} aria-label={count > 0 ? `Notifications (${count} unread)` : 'Notifications'}>
        Notifications
        {count > 0 && (
          <Badge variant="brand" className={styles.countBadge}>
            {count > 99 ? '99+' : count}
          </Badge>
        )}
      </button>
      <NotificationDrawer open={open} onClose={() => setOpen(false)} organizationId={organizationId} />
    </>
  );
}
