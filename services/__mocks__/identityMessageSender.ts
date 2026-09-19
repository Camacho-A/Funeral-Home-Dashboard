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

/**
 * Manors go-live invitation-lifecycle fix (2026-09). Lets a test simulate
 * a real provider failure (Resend rejecting the request, throwing, or
 * being unconfigured) without needing a second, separately-mocked sender
 * — set once, consumed (and cleared) by the very next `send()` call so a
 * test never has to remember to reset it for later tests.
 */
let forcedSendFailureMessage: string | null = null;

export function forceNextSendToFail(message: string): void {
  forcedSendFailureMessage = message;
}

export function clearForcedSendFailure(): void {
  forcedSendFailureMessage = null;
}

export const capturingIdentityMessageSender: IdentityMessageSender = {
  async send(message) {
    if (forcedSendFailureMessage !== null) {
      const failureMessage = forcedSendFailureMessage;
      forcedSendFailureMessage = null;
      throw new Error(failureMessage);
    }
    capturedIdentityMessages.push(message);
  },
};
