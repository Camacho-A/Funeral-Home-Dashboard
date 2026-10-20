import { describe, expect, it } from 'vitest';
import { AUTO_ARCHIVE_AFTER_READ_DAYS, isArchivedForInbox } from './inboxArchiving';

const now = new Date('2026-10-20T12:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe('isArchivedForInbox', () => {
  it('archives by hand immediately', () => {
    expect(isArchivedForInbox({ readAt: null, archivedAt: daysAgo(0) }, now)).toBe(true);
  });

  it('never archives an unread notification on its own', () => {
    expect(isArchivedForInbox({ readAt: null, archivedAt: null }, now)).toBe(false);
  });

  it(`archives a read notification ${AUTO_ARCHIVE_AFTER_READ_DAYS} days after it was read, not before`, () => {
    expect(isArchivedForInbox({ readAt: daysAgo(AUTO_ARCHIVE_AFTER_READ_DAYS - 0.01), archivedAt: null }, now)).toBe(false);
    expect(isArchivedForInbox({ readAt: daysAgo(AUTO_ARCHIVE_AFTER_READ_DAYS), archivedAt: null }, now)).toBe(true);
  });

  it('treats an unreadable read time as not archived', () => {
    expect(isArchivedForInbox({ readAt: 'not-a-date', archivedAt: null }, now)).toBe(false);
  });
});
