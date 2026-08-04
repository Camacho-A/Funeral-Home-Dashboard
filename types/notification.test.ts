import { describe, expect, it } from 'vitest';
import { isTerminalNotificationStatus, type NotificationStatus } from './notification';

describe('isTerminalNotificationStatus', () => {
  it('treats archived/cancelled as terminal', () => {
    expect(isTerminalNotificationStatus('archived')).toBe(true);
    expect(isTerminalNotificationStatus('cancelled')).toBe(true);
  });

  it('treats draft/queued/active as non-terminal', () => {
    const nonTerminal: NotificationStatus[] = ['draft', 'queued', 'active'];
    for (const status of nonTerminal) {
      expect(isTerminalNotificationStatus(status)).toBe(false);
    }
  });
});
