import type { IdentityMessage, IdentityMessageSender } from '../../lib/identity/messageSender';

/**
 * Phase 21 security correction (2026-07-25). The test-only capturing
 * adapter — route/Server Action tests `vi.mock('@/lib/identity/messageSender', ...)`
 * to substitute this for `getIdentityMessageSender()`, so a test can
 * assert the correct message (and, critically, the correct token) was
 * *sent* without that token ever having appeared in an HTTP response —
 * matching every other `services/__mocks__/*` fixture's "reset the shared
 * array in beforeEach/afterEach" convention.
 */
export const capturedIdentityMessages: IdentityMessage[] = [];

export const capturingIdentityMessageSender: IdentityMessageSender = {
  async send(message) {
    capturedIdentityMessages.push(message);
  },
};
