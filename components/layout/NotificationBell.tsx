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
 *
 * Mobile TopBar design correction (2026-09): the literal word
 * "Notifications" doesn't fit the mobile top action row — below the
 * shared 860px breakpoint this renders a small bell glyph instead (a
 * plain inline SVG, since this codebase has no icon library/existing
 * bell asset to reuse — see this task's own report for why a hand-drawn
 * glyph was the only option). This is still the SAME button: same
 * onClick, same `aria-label` (already fully describes the control
 * regardless of which child is visually shown), same unread-count
 * badge, same NotificationDrawer — only which of the two children
 * (text vs. icon) CSS shows at a given width changes. Desktop (above
 * 860px) is pixel-identical to before.
 */
export function NotificationBell() {
  const { organizationId } = useOrganization();
  const [open, setOpen] = useState(false);
  const unreadCount = useUnreadNotificationCount(organizationId);
  const count = unreadCount.data ?? 0;

  return (
    <>
      <button type="button" className={styles.bellButton} onClick={() => setOpen(true)} aria-label={count > 0 ? `Notifications (${count} unread)` : 'Notifications'}>
        <svg className={styles.bellIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 2.5a5 5 0 0 0-5 5v2.86c0 .46-.16.91-.46 1.26l-1.2 1.42c-.56.67-.09 1.68.78 1.68h11.76c.87 0 1.34-1.01.78-1.68l-1.2-1.42a1.98 1.98 0 0 1-.46-1.26V7.5a5 5 0 0 0-5-5Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M8.1 16a1.9 1.9 0 0 0 3.8 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="sr-only">Notifications</span>
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
