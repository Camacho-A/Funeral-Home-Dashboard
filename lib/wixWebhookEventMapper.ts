import type { WebhookEventRecord, WebhookEventState } from '../types/webhookEvent';

/**
 * Phase 19B (Clover Hosted Checkout Integration) — durability correction.
 * Durable webhook-delivery deduplication AND processing-lifecycle
 * tracking, backed by the `webhookEvents` Wix collection. See
 * docs/WIX_DATA_SCHEMA.md and
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md.
 *
 * Clover's Hosted Checkout webhook payload does not include a distinct,
 * stable "event id" separate from the payment's own id (confirmed from
 * Clover's own documentation — see ADR-022's "documented gap" notes) and
 * does not document delivery guarantees (at-least-once vs. exactly-once,
 * retry behavior). Rather than trust "no duplicate delivery" or invent an
 * unconfirmed event-id field, Beacon computes its own deterministic
 * `eventFingerprint` from the verified payload's own stable fields
 * (merchantId, checkout session id, payment id, status) and uses it as
 * this collection's item `_id` — Wix's own system `_id` uniqueness is
 * always enforced server-side, so a duplicate fingerprint insert reliably
 * fails with a 409, regardless of which Beacon process or server instance
 * attempts it, and regardless of process restarts. This is what makes the
 * initial *claim* durable and atomic rather than in-memory.
 *
 * `receivedAt` (the original field name) is intentionally kept as the Wix
 * field key for what the TypeScript domain type calls `firstReceivedAt` —
 * renaming a Wix field's key isn't supported without the same
 * add-a-new-field dance every other correction in this phase already
 * used, and "first received" is exactly what this field always meant.
 */

export type WixWebhookEventItem = {
  provider?: unknown;
  providerCheckoutId?: unknown;
  receivedAt?: unknown; // maps to WebhookEventRecord.firstReceivedAt
  state?: unknown;
  attemptCount?: unknown;
  lastAttemptAt?: unknown;
  completedAt?: unknown;
};

const VALID_STATES: WebhookEventState[] = ['processing', 'completed', 'failed'];

function isValidState(value: unknown): value is WebhookEventState {
  return typeof value === 'string' && (VALID_STATES as string[]).includes(value);
}

export function mapWixWebhookEventItem(
  fingerprint: string,
  item: WixWebhookEventItem | undefined,
): WebhookEventRecord | null {
  if (
    !item ||
    typeof item.provider !== 'string' ||
    typeof item.providerCheckoutId !== 'string' ||
    typeof item.receivedAt !== 'string' ||
    !isValidState(item.state) ||
    typeof item.attemptCount !== 'number' ||
    typeof item.lastAttemptAt !== 'string'
  ) {
    return null;
  }

  return {
    fingerprint,
    provider: item.provider,
    providerCheckoutId: item.providerCheckoutId,
    firstReceivedAt: item.receivedAt,
    state: item.state,
    attemptCount: item.attemptCount,
    lastAttemptAt: item.lastAttemptAt,
    completedAt: typeof item.completedAt === 'string' ? item.completedAt : null,
  };
}

export function buildWixWebhookEventData(record: WebhookEventRecord): WixWebhookEventItem {
  return {
    provider: record.provider,
    providerCheckoutId: record.providerCheckoutId,
    receivedAt: record.firstReceivedAt,
    state: record.state,
    attemptCount: record.attemptCount,
    lastAttemptAt: record.lastAttemptAt,
    completedAt: record.completedAt,
  };
}

/**
 * Merges a partial lifecycle update onto the existing full Wix item —
 * Wix Data's updateDataItem is a full replace, so the merge always
 * happens here, never a bare partial sent directly.
 */
export function applyWebhookEventUpdateToWixData(
  existing: WixWebhookEventItem,
  patch: Partial<WebhookEventRecord>,
): WixWebhookEventItem {
  const next: WixWebhookEventItem = { ...existing };

  if (patch.state !== undefined) next.state = patch.state;
  if (patch.attemptCount !== undefined) next.attemptCount = patch.attemptCount;
  if (patch.lastAttemptAt !== undefined) next.lastAttemptAt = patch.lastAttemptAt;
  if (patch.completedAt !== undefined) next.completedAt = patch.completedAt;

  return next;
}
