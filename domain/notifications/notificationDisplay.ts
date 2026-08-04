import type { NotificationStatus } from '@/types/notification';
import type { BadgeVariant } from '@/components/ui/Badge';

/**
 * Phase 28 (Communications & Notifications). Which `NotificationStatus`
 * maps to which label/Badge variant — a domain decision, kept out of
 * `NotificationDrawer.tsx` per `Badge`'s own convention (see
 * `domain/activity/activityDisplay.ts` for the identical pattern). Most
 * inbox items are simply `active`; this exists for the org-wide log and
 * the rare "still a draft" / "cancelled" row.
 */
export const NOTIFICATION_STATUS_LABEL: Record<NotificationStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  active: 'Active',
  archived: 'Archived',
  cancelled: 'Cancelled',
};

export function notificationStatusVariant(status: NotificationStatus): BadgeVariant {
  if (status === 'cancelled') return 'danger';
  if (status === 'draft' || status === 'queued') return 'neutral';
  return 'brand';
}
