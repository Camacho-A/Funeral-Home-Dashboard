import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { cloverProvider } from '@/lib/clover/cloverProvider';
import { getCloverMerchantId } from '@/lib/clover/cloverConfig';
import {
  getEnabledIntegration,
  findPaymentRecordByCheckoutId,
  updatePaymentRecordByCheckoutId,
  claimWebhookEvent,
  markWebhookEventCompleted,
  markWebhookEventFailed,
} from '@/services/paymentsService';
import { markCasePaidIfVerified } from '@/services/paymentWorkflow';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Public endpoint — no
 * session, no organizationId query param; Clover itself is the caller.
 * Authenticity comes entirely from the `Clover-Signature` header (see
 * lib/clover/cloverWebhook.ts). This is the one authoritative source for
 * "did a payment actually succeed" — the browser return-redirect never is
 * (see the payments/return page's own comment and
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md).
 *
 * Never logs the raw body or any request header — every branch below
 * that reports a problem describes *why* in generic terms, never by
 * echoing what was received. `request.text()` is read once and reused for
 * both the correlation-lookup parse and the signature verification, since
 * signature verification must run against the exact raw bytes, never a
 * parsed-and-re-serialized copy (JSON.stringify can reorder keys/change
 * whitespace, silently breaking a byte-exact HMAC).
 *
 * Final durability correction: claiming a webhook event's fingerprint
 * (see services/paymentsService.ts's claimWebhookEvent) is deliberately
 * NOT the same thing as successfully processing it. A claimed event stays
 * in 'processing' until its PaymentRecord update actually succeeds, at
 * which point it's marked 'completed'; if processing fails for any
 * reason, it's marked 'failed' (or left as a stale 'processing' claim,
 * eligible for reclaim later) and this handler returns a non-2xx status
 * so Clover retries. The one thing this route must never do is return
 * `{received: true}` for an event whose PaymentRecord update didn't
 * actually happen — a database failure is a 503, never a 200.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  // Step 1: extract just enough to know which organization's webhook
  // secret to verify against — a read-only lookup, no state changes yet,
  // and nothing here is trusted until signature verification (step 3)
  // succeeds.
  let correlationId: string | undefined;
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    correlationId = typeof parsed.data === 'string' ? parsed.data : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!correlationId) {
    return NextResponse.json({ error: 'Missing checkout session correlation id.' }, { status: 400 });
  }

  const dataAdapterMode = getDataAdapterMode();

  // Step 2: correlate to a PaymentRecord to learn which organization (and
  // therefore which integration/secret) this event claims to be for.
  const record = await findPaymentRecordByCheckoutId('clover', correlationId, dataAdapterMode);
  if (!record) {
    // Return promptly with 200 — nothing to retry; Beacon has no record
    // of this checkout session at all (stale, foreign, or malformed), so
    // there's nothing actionable here regardless of signature validity.
    return NextResponse.json({ received: true });
  }

  const integration = await getEnabledIntegration(record.organizationId, 'clover', dataAdapterMode);
  if (!integration) {
    return NextResponse.json({ received: true });
  }

  // Step 3: verify the signature against the *correct* organization's
  // webhook secret — resolved only from Beacon's own stored data above,
  // never from anything in the request itself.
  const verification = cloverProvider.verifyWebhook(rawBody, request.headers, integration);
  if (!verification.valid) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }

  const update = cloverProvider.mapProviderPayment(verification.payload);

  // Step 4: merchant isolation — a verified signature only proves the
  // event came from *some* Clover merchant using this secret; confirm
  // the event's own merchantId actually matches the organization the
  // correlated PaymentRecord belongs to, closing the gap where a secret
  // reused or misconfigured across merchants could otherwise let one
  // merchant's webhook update another organization's payment.
  const payload = verification.payload as { merchantId?: unknown };
  const expectedMerchantId = getCloverMerchantId(integration);
  if (typeof payload.merchantId !== 'string' || payload.merchantId !== expectedMerchantId) {
    return NextResponse.json({ error: 'Merchant mismatch.' }, { status: 401 });
  }

  // Deliberately excludes the delivery timestamp — Clover may redeliver
  // the identical event with a different `t=` value, and the fingerprint
  // must still match that redelivery, not just the first attempt.
  const eventFingerprint = createHash('sha256')
    .update(`${expectedMerchantId}|${correlationId}|${update.providerPaymentId ?? ''}|${update.status}`)
    .digest('hex');

  try {
    // Step 5: claim the event. 'already-completed' means this exact event
    // was already fully processed — ack without reapplying.
    // 'currently-processing' means another (still-live) request is
    // handling it right now — ack without applying concurrently, rather
    // than racing it. 'claimed' covers both a brand-new event and a
    // reclaimed 'failed'/stale-'processing' one — either way, proceed.
    const claim = await claimWebhookEvent(
      eventFingerprint,
      { provider: 'clover', providerCheckoutId: correlationId },
      dataAdapterMode,
    );
    if (claim.outcome === 'already-completed' || claim.outcome === 'currently-processing') {
      return NextResponse.json({ received: true });
    }

    // Step 6: idempotent, order-tolerant apply. Once a record has reached
    // a terminal state (succeeded/failed/cancelled/refunded) via some
    // other path, this event's own intent is already satisfied — mark it
    // completed without reapplying, never a failure.
    if (record.status !== 'pending') {
      await markWebhookEventCompleted(eventFingerprint, dataAdapterMode);
      return NextResponse.json({ received: true });
    }

    const nowIso = new Date().toISOString();
    const updated = await updatePaymentRecordByCheckoutId(
      record.organizationId,
      correlationId,
      {
        providerPaymentId: update.providerPaymentId,
        status: update.status,
        cardBrand: update.cardBrand,
        cardLast4: update.cardLast4,
        receiptReference: update.receiptReference,
        failureCode: update.failureCode,
        failureMessage: update.failureMessage,
        paidAt: update.status === 'succeeded' ? nowIso : null,
        updatedAt: nowIso,
      },
      dataAdapterMode,
    );

    if (!updated) {
      // The PaymentRecord update itself didn't take — a real failure.
      // Mark the claim failed (a retry will reclaim and try again) and
      // return non-2xx so Clover retries; never acknowledge success for
      // work that didn't actually happen.
      await markWebhookEventFailed(eventFingerprint, dataAdapterMode);
      return NextResponse.json({ error: 'Failed to update payment record.' }, { status: 503 });
    }

    if (updated.status === 'succeeded') {
      await markCasePaidIfVerified(record.organizationId, record.caseId, dataAdapterMode);
    }

    await markWebhookEventCompleted(eventFingerprint, dataAdapterMode);
    return NextResponse.json({ received: true });
  } catch (error) {
    // Covers a claim-time database failure (claimWebhookEvent throws on
    // anything other than a genuine duplicate-key conflict) as well as
    // any failure during processing — either way, this must never be a
    // 200. Best-effort mark the claim failed so a retry doesn't sit
    // behind a stale 'processing' claim for the full timeout window;
    // if even that fails (e.g. the claim was never actually written),
    // markWebhookEventFailed's own no-op-if-missing behavior makes this
    // safe to call regardless.
    try {
      await markWebhookEventFailed(eventFingerprint, dataAdapterMode);
    } catch {
      // Do not let a secondary failure here mask the original error below.
    }
    const message = error instanceof Error ? error.message : 'Unknown error processing webhook.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
