/**
 * Phase 28 (Communications & Notifications). The in-app delivery channel
 * — trivial by design: a `NotificationRecipient` row's association with
 * its `Notification` row *is* the in-app inbox entry, so there is no
 * external call to make and delivering it always succeeds instantly.
 * This function exists purely so `services/notificationService.ts` can
 * treat every channel uniformly in its per-channel dispatch loop, and so
 * the in-app channel has its own structurally-enforced import boundary
 * exactly like `emailChannel.ts` does.
 */
export async function deliverInApp(): Promise<{ succeeded: true }> {
  return { succeeded: true };
}
