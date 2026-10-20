import type { NotificationRecipient } from '../../types/notificationRecipient';

/**
 * Automatic archiving of read notifications (2026-10).
 *
 * A notification someone has read stays in their inbox for
 * AUTO_ARCHIVE_AFTER_READ_DAYS, so it can still be found again right after
 * it was opened, and then moves to Archived by itself. Staff no longer have
 * to archive every handled notification by hand to keep the inbox short.
 *
 * Computed, not stored: nothing sweeps or rewrites recipient rows, so there
 * is no background job and no write to fail. A notification archived by
 * hand keeps its own `archivedAt`; one archived automatically is simply
 * treated as archived from that day on. Both appear under "Show archived".
 * An unread notification is never archived automatically.
 */
export const AUTO_ARCHIVE_AFTER_READ_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isArchivedForInbox(
  recipient: Pick<NotificationRecipient, 'readAt' | 'archivedAt'>,
  now: Date = new Date(),
): boolean {
  if (recipient.archivedAt !== null) return true;
  if (recipient.readAt === null) return false;
  const readAt = Date.parse(recipient.readAt);
  if (Number.isNaN(readAt)) return false;
  return now.getTime() - readAt >= AUTO_ARCHIVE_AFTER_READ_DAYS * DAY_MS;
}
