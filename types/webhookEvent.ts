/**
 * Phase 19B (Clover Hosted Checkout Integration) — final durability
 * correction. A `WebhookEventRecord` is Beacon's own durable record of
 * "have I already, successfully finished processing this exact webhook
 * event" — distinct from a `PaymentRecord`, which tracks the *payment's*
 * lifecycle. Conflating the two (the previous design: a bare presence
 * check on the fingerprint) meant a webhook whose signature verified but
 * whose downstream PaymentRecord update failed would permanently "claim"
 * the fingerprint — any later retry from Clover would be silently
 * acknowledged without ever actually applying the update. This type
 * exists so "claimed" and "successfully completed" are different,
 * durably-persisted states. See
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md and
 * services/paymentsService.ts's claimWebhookEvent/markWebhookEventCompleted/
 * markWebhookEventFailed.
 */

export type WebhookEventState = 'processing' | 'completed' | 'failed';

export type WebhookEventRecord = {
  /** The deterministic fingerprint this event was claimed under — also
      this record's Wix system `_id` (see lib/wixWebhookEventMapper.ts),
      which is what makes the *initial* claim atomic. */
  fingerprint: string;
  provider: string;
  /** Reference only, for reconciliation/debugging — never the dedup key
      itself (the fingerprint is). */
  providerCheckoutId: string;
  state: WebhookEventState;
  /** How many times processing has been attempted for this fingerprint —
      1 on first claim, incremented on every reclaim (a retry of a
      'failed' event, or recovery of a stale 'processing' one). */
  attemptCount: number;
  /** When this fingerprint was first claimed — never changes after that,
      even across retries/reclaims. */
  firstReceivedAt: string;
  /** When the most recent attempt (claim or reclaim) started — used to
      detect a stale 'processing' claim (a prior attempt that started but
      never reached a terminal state, e.g. the process crashed
      mid-request). */
  lastAttemptAt: string;
  /** Set only once state becomes 'completed'. */
  completedAt: string | null;
};
