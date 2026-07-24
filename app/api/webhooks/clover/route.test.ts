import { createHash, createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import { paymentRecordFixtures, webhookEventFixtures } from '@/services/__mocks__/paymentFixtures';
import { findPaymentConfirmationChecklistIndex } from '@/domain/cases/paymentChecklist';
import type { PaymentRecord } from '@/types/payment';
import type { WebhookEventRecord } from '@/types/webhookEvent';

/**
 * Correction pass (durable event-processing lifecycle): a few tests below
 * need `updatePaymentRecordByCheckoutId` to fail exactly once — simulating
 * a real downstream failure after the event has already been claimed —
 * then succeed on Clover's retry. `vi.hoisted` is required so the mock
 * factory (hoisted above these imports by Vitest) can close over a flag
 * the test bodies set later. See components/modals/NewCaseModal.test.tsx's
 * `pushMock` for the same established pattern in this codebase.
 */
const { updateShouldFailOnce } = vi.hoisted(() => ({ updateShouldFailOnce: { value: false } }));

vi.mock('@/services/paymentsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/paymentsService')>();
  return {
    ...actual,
    updatePaymentRecordByCheckoutId: async (...args: Parameters<typeof actual.updatePaymentRecordByCheckoutId>) => {
      if (updateShouldFailOnce.value) {
        updateShouldFailOnce.value = false;
        return null; // simulates a real failed/not-found update — a genuine failure, not a thrown error
      }
      return actual.updatePaymentRecordByCheckoutId(...args);
    },
  };
});

/**
 * Only exercised by the "database failure during claim" describe block
 * below (wix mode) — every other test in this file runs in mock mode,
 * which never reaches lib/wixDataApi at all, so this mock sits unused
 * for them. Declared here (not via `vi.doMock` inside a `beforeEach`)
 * because `services/paymentsService.ts`'s REAL implementation (used via
 * `importOriginal` above) itself statically imports `@/lib/wixDataApi` —
 * only a module-graph-wide `vi.mock`, resolved before the shared `route`
 * module below is first imported, reliably intercepts that transitive
 * import too.
 */
let mockQueryWixDataItems = vi.fn();
let mockInsertWixDataItem = vi.fn();
vi.mock('@/lib/wixDataApi', async () => {
  const { getWixServerConfig } = await import('@/lib/env');
  const actual = await vi.importActual<typeof import('@/lib/wixDataApi')>('@/lib/wixDataApi');
  return {
    ...actual,
    queryWixDataItems: (...args: unknown[]) => {
      getWixServerConfig();
      return mockQueryWixDataItems(...args);
    },
    insertWixDataItem: (...args: unknown[]) => {
      getWixServerConfig();
      return mockInsertWixDataItem(...args);
    },
  };
});

const { POST } = await import('./route');

const WEBHOOK_SECRET = 'fake-webhook-secret';
const MERCHANT_ID = 'mock-merchant-id-value'; // resolved via CLOVER_MOCK_MERCHANT_ID below, matching paymentIntegrationFixtures[0].merchantIdReference

function signedRequest(body: string, timestamp: number, secret = WEBHOOK_SECRET) {
  const hash = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return new Request('http://localhost/api/webhooks/clover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Clover-Signature': `t=${timestamp},v1=${hash}` },
    body,
  });
}

function eventBody(overrides: Partial<{ id: string; data: string; status: string; message: string; merchantId: string }> = {}) {
  return JSON.stringify({
    createdTime: 1,
    type: 'PAYMENT',
    id: 'payment-uuid-1',
    data: 'checkout-uuid-1',
    status: 'APPROVED',
    merchantId: MERCHANT_ID,
    ...overrides,
  });
}

let seededPayment: PaymentRecord;
let caseFixtureIndex = -1;
let originalCaseFixture: (typeof caseFixtures)[number];

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  process.env.CLOVER_MOCK_MERCHANT_ID = MERCHANT_ID;
  process.env.CLOVER_MOCK_WEBHOOK_SECRET = WEBHOOK_SECRET;
  paymentRecordFixtures.length = 0;
  webhookEventFixtures.clear();
  updateShouldFailOnce.value = false;

  // Deliberately a case that starts 'awaiting_payment' — some seed cases
  // are already 'paid_in_full', which would make the "never marks paid on
  // a DECLINED event" assertion meaningless (already true beforehand).
  caseFixtureIndex = caseFixtures.findIndex(
    (c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted && c.paymentStatus === 'awaiting_payment',
  );
  originalCaseFixture = caseFixtures[caseFixtureIndex];

  seededPayment = {
    id: 'payment-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: originalCaseFixture.id,
    provider: 'clover',
    providerCheckoutId: 'checkout-uuid-1',
    providerPaymentId: null,
    idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
    checkoutUrl: 'https://apisandbox.dev.clover.com/checkout-uuid-1',
    status: 'pending',
    amount: 120000,
    currency: 'usd',
    purpose: 'Cremation service fee',
    cardBrand: null,
    cardLast4: null,
    receiptReference: null,
    failureCode: null,
    failureMessage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    paidAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  paymentRecordFixtures.push(seededPayment);
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  delete process.env.CLOVER_MOCK_MERCHANT_ID;
  delete process.env.CLOVER_MOCK_WEBHOOK_SECRET;
  paymentRecordFixtures.length = 0;
  webhookEventFixtures.clear();
  // markCasePaidIfVerified's mock branch replaces caseFixtures[index] with
  // a new object — restore it so no test's webhook-triggered case update
  // leaks into the next test.
  if (caseFixtureIndex !== -1) caseFixtures[caseFixtureIndex] = originalCaseFixture;
});

describe('POST /api/webhooks/clover — signature verification', () => {
  it('accepts a validly-signed APPROVED event and marks the payment succeeded', async () => {
    const now = Math.floor(Date.now() / 1000);
    const response = await POST(signedRequest(eventBody(), now));
    expect(response.status).toBe(200);

    const updated = paymentRecordFixtures.find((p) => p.id === 'payment-1')!;
    expect(updated.status).toBe('succeeded');
    expect(updated.providerPaymentId).toBe('payment-uuid-1');
  });

  it('rejects an invalidly-signed request with 401 and never updates the record', async () => {
    const now = Math.floor(Date.now() / 1000);
    const response = await POST(signedRequest(eventBody(), now, 'wrong-secret'));
    expect(response.status).toBe(401);
    expect(paymentRecordFixtures.find((p) => p.id === 'payment-1')!.status).toBe('pending');
  });

  it('rejects a request with no signature header at all', async () => {
    const response = await POST(
      new Request('http://localhost/api/webhooks/clover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: eventBody(),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects invalid JSON with 400', async () => {
    const response = await POST(
      new Request('http://localhost/api/webhooks/clover', { method: 'POST', body: 'not json at all' }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a body missing the checkout-session correlation field', async () => {
    const response = await POST(
      new Request('http://localhost/api/webhooks/clover', { method: 'POST', body: JSON.stringify({ status: 'APPROVED' }) }),
    );
    expect(response.status).toBe(400);
  });
});

describe('POST /api/webhooks/clover — correlation and isolation', () => {
  it('returns 200 (not an error) for an unknown checkout session id — nothing to retry', async () => {
    const now = Math.floor(Date.now() / 1000);
    const response = await POST(signedRequest(eventBody({ data: 'no-such-checkout' }), now));
    expect(response.status).toBe(200);
  });

  it('rejects a merchantId mismatch even with an otherwise-valid signature — merchant isolation', async () => {
    const now = Math.floor(Date.now() / 1000);
    const response = await POST(signedRequest(eventBody({ merchantId: 'someone-elses-merchant' }), now));
    expect(response.status).toBe(401);
    expect(paymentRecordFixtures.find((p) => p.id === 'payment-1')!.status).toBe('pending');
  });
});

describe('POST /api/webhooks/clover — idempotency and ordering', () => {
  it('is a no-op on duplicate delivery of the same APPROVED event', async () => {
    const now = Math.floor(Date.now() / 1000);
    await POST(signedRequest(eventBody(), now));
    const afterFirst = { ...paymentRecordFixtures.find((p) => p.id === 'payment-1')! };

    const response = await POST(signedRequest(eventBody(), now + 1));
    expect(response.status).toBe(200);
    expect(paymentRecordFixtures.find((p) => p.id === 'payment-1')).toEqual(afterFirst);
  });

  it('never lets an out-of-order DECLINED event downgrade an already-succeeded payment', async () => {
    const now = Math.floor(Date.now() / 1000);
    await POST(signedRequest(eventBody({ status: 'APPROVED' }), now));
    expect(paymentRecordFixtures.find((p) => p.id === 'payment-1')!.status).toBe('succeeded');

    await POST(signedRequest(eventBody({ status: 'DECLINED', message: 'stale decline' }), now + 5));
    expect(paymentRecordFixtures.find((p) => p.id === 'payment-1')!.status).toBe('succeeded');
  });

  it('applies a DECLINED event to a still-pending record', async () => {
    const now = Math.floor(Date.now() / 1000);
    const response = await POST(signedRequest(eventBody({ status: 'DECLINED', message: 'Card declined' }), now));
    expect(response.status).toBe(200);

    const updated = paymentRecordFixtures.find((p) => p.id === 'payment-1')!;
    expect(updated.status).toBe('failed');
    expect(updated.failureMessage).toBe('Card declined');
  });

  /**
   * Correction pass: durable dedup (recordWebhookEventIfNew), not the
   * status-based guard, is what's actually asserted here — the event
   * fingerprint is recorded BEFORE the status check runs (see the route's
   * own step ordering), so this proves the dedup layer itself catches a
   * repeat, independent of whatever the record's current status happens
   * to be.
   */
  it('records the event fingerprint on first delivery and treats a byte-different but semantically-identical redelivery as a duplicate', async () => {
    const now = Math.floor(Date.now() / 1000);
    await POST(signedRequest(eventBody(), now));
    expect(webhookEventFixtures.size).toBe(1);

    // A redelivery is not required to be byte-identical — only the fields
    // the fingerprint is computed from (merchant, checkout id, payment
    // id, status) need to match; createdTime/message can legitimately
    // differ between a genuine retry attempt and still be "the same event".
    await POST(signedRequest(eventBody({ message: 'a different message text' }), now + 2));
    expect(webhookEventFixtures.size).toBe(1); // no new fingerprint recorded
  });

  it('survives concurrent duplicate deliveries — only one update is ever applied', async () => {
    const now = Math.floor(Date.now() / 1000);
    const [firstResponse, secondResponse] = await Promise.all([
      POST(signedRequest(eventBody(), now)),
      POST(signedRequest(eventBody(), now)),
    ]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(webhookEventFixtures.size).toBe(1);
    expect(paymentRecordFixtures.find((p) => p.id === 'payment-1')!.status).toBe('succeeded');
  });
});

describe('POST /api/webhooks/clover — durable event-processing lifecycle (final correction)', () => {
  /** Mirrors the route's own fingerprint formula exactly — see that
      file's own comment on why the delivery timestamp is excluded. */
  function expectedFingerprint(merchantId: string, checkoutId: string, paymentId: string, status: string): string {
    return createHash('sha256').update(`${merchantId}|${checkoutId}|${paymentId}|${status}`).digest('hex');
  }

  it('claims the event, marks it failed (not completed) when the PaymentRecord update fails, and Clover\'s retry of the identical webhook succeeds and finishes completed', async () => {
    updateShouldFailOnce.value = true;
    const now = Math.floor(Date.now() / 1000);

    // First delivery: claim succeeds, but the downstream PaymentRecord
    // update fails — must be a non-2xx response (never {received: true})
    // so Clover retries, and the payment must remain untouched.
    const firstResponse = await POST(signedRequest(eventBody(), now));
    expect(firstResponse.status).toBe(503);
    expect(paymentRecordFixtures.find((p) => p.id === 'payment-1')!.status).toBe('pending');

    const fingerprint = expectedFingerprint(MERCHANT_ID, 'checkout-uuid-1', 'payment-uuid-1', 'succeeded');
    expect(webhookEventFixtures.get(fingerprint)?.state).toBe('failed');
    expect(webhookEventFixtures.get(fingerprint)?.attemptCount).toBe(1);

    // Clover retries the identical webhook (a new delivery, hence a new
    // signature timestamp — but the same merchant/checkout/payment/status,
    // so the same fingerprint). This time the update succeeds.
    const secondResponse = await POST(signedRequest(eventBody(), now + 5));
    expect(secondResponse.status).toBe(200);
    expect(paymentRecordFixtures.find((p) => p.id === 'payment-1')!.status).toBe('succeeded');

    const finalEvent = webhookEventFixtures.get(fingerprint)!;
    expect(finalEvent.state).toBe('completed');
    expect(finalEvent.attemptCount).toBe(2);
    expect(finalEvent.completedAt).not.toBeNull();
  });

  it('recovers a stale "processing" claim — a prior delivery that never reached a terminal state (e.g. a crash mid-request) does not permanently block reprocessing', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fingerprint = expectedFingerprint(MERCHANT_ID, 'checkout-uuid-1', 'payment-uuid-1', 'succeeded');

    // Pre-seed a stale claim, as if an earlier delivery started
    // processing and then the process died before finishing.
    const staleClaim: WebhookEventRecord = {
      fingerprint,
      provider: 'clover',
      providerCheckoutId: 'checkout-uuid-1',
      state: 'processing',
      attemptCount: 1,
      firstReceivedAt: '2020-01-01T00:00:00.000Z',
      lastAttemptAt: '2020-01-01T00:00:00.000Z',
      completedAt: null,
    };
    webhookEventFixtures.set(fingerprint, staleClaim);

    const response = await POST(signedRequest(eventBody(), now));
    expect(response.status).toBe(200);
    expect(paymentRecordFixtures.find((p) => p.id === 'payment-1')!.status).toBe('succeeded');

    const finalEvent = webhookEventFixtures.get(fingerprint)!;
    expect(finalEvent.state).toBe('completed');
    expect(finalEvent.attemptCount).toBe(2); // reclaimed, not a fresh claim
    expect(finalEvent.firstReceivedAt).toBe('2020-01-01T00:00:00.000Z'); // preserved across the reclaim
  });

  it('does not apply concurrently while a claim is still fresh — a second delivery arriving mid-processing is acknowledged without reprocessing', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fingerprint = expectedFingerprint(MERCHANT_ID, 'checkout-uuid-1', 'payment-uuid-1', 'succeeded');

    const freshClaim: WebhookEventRecord = {
      fingerprint,
      provider: 'clover',
      providerCheckoutId: 'checkout-uuid-1',
      state: 'processing',
      attemptCount: 1,
      firstReceivedAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      completedAt: null,
    };
    webhookEventFixtures.set(fingerprint, freshClaim);

    const response = await POST(signedRequest(eventBody(), now));
    expect(response.status).toBe(200);
    // Never reprocessed — the payment stays exactly as it was, and the
    // claim is untouched (still attemptCount 1, still 'processing').
    expect(paymentRecordFixtures.find((p) => p.id === 'payment-1')!.status).toBe('pending');
    expect(webhookEventFixtures.get(fingerprint)).toEqual(freshClaim);
  });
});

describe('POST /api/webhooks/clover — a database failure during claim never acknowledges success (wix mode)', () => {
  const INTEGRATION_DATA = {
    beaconIntegrationId: 'org-clover',
    organizationId: DEFAULT_ORGANIZATION_ID,
    provider: 'clover',
    environment: 'sandbox',
    merchantIdReference: 'CLOVER_MOCK_MERCHANT_ID',
    credentialReference: 'CLOVER_MOCK_PRIVATE_KEY',
    webhookSecretReference: 'CLOVER_MOCK_WEBHOOK_SECRET',
    isEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';

    mockQueryWixDataItems = vi.fn().mockImplementation((collectionId: string) => {
      if (collectionId === 'paymentIntegrations') {
        return Promise.resolve({ dataItems: [{ id: 'org-clover', dataCollectionId: 'paymentIntegrations', data: INTEGRATION_DATA }] });
      }
      if (collectionId === 'paymentRecords') {
        return Promise.resolve({
          dataItems: [
            {
              id: 'payment-1',
              dataCollectionId: 'paymentRecords',
              data: {
                beaconPaymentId: 'payment-1',
                organizationId: DEFAULT_ORGANIZATION_ID,
                caseId: 'case-1',
                provider: 'clover',
                providerCheckoutId: 'checkout-uuid-1',
                idempotencyKey: `${DEFAULT_ORGANIZATION_ID}:key-1`,
                status: 'pending',
                amount: 1000,
                currency: 'usd',
                purpose: 'Fee',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          ],
        });
      }
      return Promise.resolve({ dataItems: [] });
    });
    // The claim's own insert into `webhookEvents` fails for a genuine
    // (non-conflict) reason — a real database/network failure, not a
    // duplicate-key 409 (a plain Error, never a WixDataApiError, so
    // isWixConflict correctly treats this as a real failure to propagate,
    // not "already claimed").
    mockInsertWixDataItem = vi.fn().mockRejectedValue(new Error('Wix Data insert failed for collection "webhookEvents" (HTTP 500).'));
  });

  afterEach(() => {
    delete process.env.WIX_API_KEY;
    delete process.env.WIX_SITE_ID;
    mockQueryWixDataItems = vi.fn();
    mockInsertWixDataItem = vi.fn();
  });

  it('returns a non-2xx response and never {received: true} when claiming the event itself fails', async () => {
    const now = Math.floor(Date.now() / 1000);
    const response = await POST(signedRequest(eventBody(), now));
    expect(response.status).not.toBe(200);

    const body = await response.json();
    expect(body).not.toEqual({ received: true });
  });
});

describe('POST /api/webhooks/clover — case workflow effects', () => {
  it('marks Case.paymentStatus paid and the "Payment collected" checklist item done on a verified success', async () => {
    const case_ = caseFixtures.find((c) => c.id === seededPayment.caseId)!;
    const checklistIndex = findPaymentConfirmationChecklistIndex(case_.workflowSnapshot);

    const now = Math.floor(Date.now() / 1000);
    await POST(signedRequest(eventBody(), now));

    const updatedCase = caseFixtures.find((c) => c.id === seededPayment.caseId)!;
    expect(updatedCase.paymentStatus).toBe('paid_in_full');
    if (checklistIndex !== null) {
      expect(updatedCase.checklistState[checklistIndex]).toBe(true);
    }
  });

  it('never marks the case paid on a DECLINED event', async () => {
    const now = Math.floor(Date.now() / 1000);
    await POST(signedRequest(eventBody({ status: 'DECLINED' }), now));

    const updatedCase = caseFixtures.find((c) => c.id === seededPayment.caseId)!;
    expect(updatedCase.paymentStatus).not.toBe('paid_in_full');
  });
});

describe('POST /api/webhooks/clover — no sensitive data ever appears in error responses', () => {
  it('an invalid-signature error response never echoes the webhook secret or raw body', async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = eventBody();
    const response = await POST(signedRequest(body, now, 'wrong-secret'));
    const text = await response.text();
    expect(text).not.toContain(WEBHOOK_SECRET);
  });
});
