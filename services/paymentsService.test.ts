import { afterEach, describe, expect, it } from 'vitest';
import {
  getEnabledIntegration,
  listPaymentRecordsForCase,
  getPaymentRecordById,
  findPaymentRecordByCheckoutId,
  findPaymentRecordByIdempotencyKey,
  createIdempotentPendingPaymentRecord,
  updatePaymentRecord,
  updatePaymentRecordByCheckoutId,
  createPaymentIntegration,
  claimWebhookEvent,
  markWebhookEventCompleted,
  markWebhookEventFailed,
} from './paymentsService';
import {
  paymentRecordFixtures,
  paymentIntegrationFixtures,
  webhookEventFixtures,
  CLOVER_INTEGRATION_MOCK_ID,
} from './__mocks__/paymentFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Mock-mode coverage for
 * services/paymentsService.ts — the "mock adapter behavior" requirement
 * called for explicitly. wix-mode's equivalents (the real atomic
 * conflict-on-insert behavior) are exercised through the Route Handler
 * tests, which mock lib/wixDataApi.ts, and were additionally verified
 * empirically against the live Wix collections (see
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md).
 */

afterEach(() => {
  paymentRecordFixtures.length = 0;
  webhookEventFixtures.clear();
});

function idempotentParams(overrides: Partial<Parameters<typeof createIdempotentPendingPaymentRecord>[0]> = {}) {
  return {
    id: 'p1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    provider: 'clover',
    amount: 1000,
    currency: 'usd',
    purpose: 'Fee',
    idempotencyKey: 'key-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('getEnabledIntegration — mock mode', () => {
  it("finds Manor's Cremation's enabled sandbox Clover integration", async () => {
    const integration = await getEnabledIntegration(DEFAULT_ORGANIZATION_ID, 'clover', 'mock');
    expect(integration?.id).toBe(CLOVER_INTEGRATION_MOCK_ID);
  });

  it('returns null for a provider with no configured integration', async () => {
    expect(await getEnabledIntegration(DEFAULT_ORGANIZATION_ID, 'stripe', 'mock')).toBeNull();
  });

  it('returns null for a disabled integration', async () => {
    const original = paymentIntegrationFixtures[0];
    paymentIntegrationFixtures[0] = { ...original, isEnabled: false };
    try {
      expect(await getEnabledIntegration(DEFAULT_ORGANIZATION_ID, 'clover', 'mock')).toBeNull();
    } finally {
      paymentIntegrationFixtures[0] = original;
    }
  });

  it('returns null for an organization with no integration at all', async () => {
    expect(await getEnabledIntegration('some-other-org', 'clover', 'mock')).toBeNull();
  });
});

describe('createIdempotentPendingPaymentRecord / listPaymentRecordsForCase / getPaymentRecordById — mock mode', () => {
  it('creates a pending record with a unique placeholder providerCheckoutId (never an empty string) and no checkoutUrl yet', async () => {
    const { record, isNew } = await createIdempotentPendingPaymentRecord(idempotentParams(), 'mock');
    expect(isNew).toBe(true);
    expect(record.status).toBe('pending');
    expect(record.providerCheckoutId).toBe('pending:p1');
    expect(record.providerCheckoutId).not.toBe('');
    expect(record.checkoutUrl).toBeNull();
  });

  it('supports multiple payments on the same case (different idempotency keys)', async () => {
    await createIdempotentPendingPaymentRecord(idempotentParams({ id: 'p1', idempotencyKey: 'key-1', purpose: 'Deposit' }), 'mock');
    await createIdempotentPendingPaymentRecord(
      idempotentParams({ id: 'p2', idempotencyKey: 'key-2', amount: 2000, purpose: 'Balance', createdAt: '2026-01-02T00:00:00.000Z' }),
      'mock',
    );

    const records = await listPaymentRecordsForCase(DEFAULT_ORGANIZATION_ID, 'case-1', 'mock');
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
  });

  it('lists most-recent first', async () => {
    await createIdempotentPendingPaymentRecord(idempotentParams({ id: 'older', idempotencyKey: 'key-older' }), 'mock');
    await createIdempotentPendingPaymentRecord(
      idempotentParams({ id: 'newer', idempotencyKey: 'key-newer', createdAt: '2026-01-02T00:00:00.000Z' }),
      'mock',
    );

    const records = await listPaymentRecordsForCase(DEFAULT_ORGANIZATION_ID, 'case-1', 'mock');
    expect(records[0].id).toBe('newer');
  });

  it("never returns another organization's or case's payment records", async () => {
    await createIdempotentPendingPaymentRecord(idempotentParams({ id: 'mine', idempotencyKey: 'key-mine' }), 'mock');
    await createIdempotentPendingPaymentRecord(
      idempotentParams({ id: 'other-org', idempotencyKey: 'key-other-org', organizationId: 'some-other-org' }),
      'mock',
    );
    await createIdempotentPendingPaymentRecord(
      idempotentParams({ id: 'other-case', idempotencyKey: 'key-other-case', caseId: 'case-2' }),
      'mock',
    );

    const records = await listPaymentRecordsForCase(DEFAULT_ORGANIZATION_ID, 'case-1', 'mock');
    expect(records.map((r) => r.id)).toEqual(['mine']);
  });

  it('getPaymentRecordById finds by organizationId+id', async () => {
    await createIdempotentPendingPaymentRecord(idempotentParams(), 'mock');
    expect((await getPaymentRecordById(DEFAULT_ORGANIZATION_ID, 'p1', 'mock'))?.id).toBe('p1');
    expect(await getPaymentRecordById('some-other-org', 'p1', 'mock')).toBeNull();
  });
});

describe('createIdempotentPendingPaymentRecord — conflict handling (the server-side race guard)', () => {
  it('returns the existing record, not a new one, when the same organization+idempotencyKey is submitted again', async () => {
    const first = await createIdempotentPendingPaymentRecord(idempotentParams({ idempotencyKey: 'shared-key' }), 'mock');
    expect(first.isNew).toBe(true);

    const second = await createIdempotentPendingPaymentRecord(
      idempotentParams({ id: 'p2-should-not-be-used', idempotencyKey: 'shared-key' }),
      'mock',
    );
    expect(second.isNew).toBe(false);
    expect(second.record.id).toBe(first.record.id);

    // Only one record was ever actually created — the conflicting request
    // never produced a second row.
    const records = await listPaymentRecordsForCase(DEFAULT_ORGANIZATION_ID, 'case-1', 'mock');
    expect(records).toHaveLength(1);
  });

  it('the same idempotencyKey for two DIFFERENT organizations never conflicts — the stored key is composed per-organization', async () => {
    const orgA = await createIdempotentPendingPaymentRecord(
      idempotentParams({ id: 'a1', organizationId: 'org-a', idempotencyKey: 'same-raw-key' }),
      'mock',
    );
    const orgB = await createIdempotentPendingPaymentRecord(
      idempotentParams({ id: 'b1', organizationId: 'org-b', idempotencyKey: 'same-raw-key' }),
      'mock',
    );
    expect(orgA.isNew).toBe(true);
    expect(orgB.isNew).toBe(true);
    expect(orgA.record.id).not.toBe(orgB.record.id);
  });

  it('findPaymentRecordByIdempotencyKey resolves the composed {organizationId}:{key} value', async () => {
    await createIdempotentPendingPaymentRecord(idempotentParams({ idempotencyKey: 'lookup-key' }), 'mock');
    const found = await findPaymentRecordByIdempotencyKey(DEFAULT_ORGANIZATION_ID, 'lookup-key', 'mock');
    expect(found?.id).toBe('p1');
    expect(await findPaymentRecordByIdempotencyKey('some-other-org', 'lookup-key', 'mock')).toBeNull();
  });
});

describe('findPaymentRecordByCheckoutId / updatePaymentRecordByCheckoutId — webhook correlation — mock mode', () => {
  it('finds a record by its providerCheckoutId regardless of which organization it belongs to (webhook has no org context)', async () => {
    await createIdempotentPendingPaymentRecord(idempotentParams(), 'mock');
    await updatePaymentRecord(DEFAULT_ORGANIZATION_ID, 'p1', { providerCheckoutId: 'checkout-xyz' }, 'mock');

    const found = await findPaymentRecordByCheckoutId('clover', 'checkout-xyz', 'mock');
    expect(found?.id).toBe('p1');
  });

  it('returns null for an unknown checkout id', async () => {
    expect(await findPaymentRecordByCheckoutId('clover', 'no-such-checkout', 'mock')).toBeNull();
  });

  it('updatePaymentRecordByCheckoutId updates the correct record, scoped by organizationId+providerCheckoutId', async () => {
    await createIdempotentPendingPaymentRecord(idempotentParams(), 'mock');
    await updatePaymentRecord(DEFAULT_ORGANIZATION_ID, 'p1', { providerCheckoutId: 'checkout-xyz' }, 'mock');

    const updated = await updatePaymentRecordByCheckoutId(DEFAULT_ORGANIZATION_ID, 'checkout-xyz', { status: 'succeeded' }, 'mock');
    expect(updated?.status).toBe('succeeded');

    expect(await updatePaymentRecordByCheckoutId('some-other-org', 'checkout-xyz', { status: 'failed' }, 'mock')).toBeNull();
  });
});

describe('claimWebhookEvent — durable event-processing lifecycle (mock mode)', () => {
  const meta = { provider: 'clover', providerCheckoutId: 'c1' };

  it('claims a brand-new fingerprint', async () => {
    const result = await claimWebhookEvent('fingerprint-1', meta, 'mock');
    expect(result).toEqual({ outcome: 'claimed' });
    expect(webhookEventFixtures.get('fingerprint-1')?.state).toBe('processing');
    expect(webhookEventFixtures.get('fingerprint-1')?.attemptCount).toBe(1);
  });

  it('a different fingerprint (a genuinely different event) is never treated as a duplicate', async () => {
    await claimWebhookEvent('fingerprint-1', meta, 'mock');
    expect(await claimWebhookEvent('fingerprint-2', meta, 'mock')).toEqual({ outcome: 'claimed' });
  });

  it('acknowledges without reapplying once an event is completed', async () => {
    await claimWebhookEvent('fingerprint-1', meta, 'mock');
    await markWebhookEventCompleted('fingerprint-1', 'mock');
    expect(await claimWebhookEvent('fingerprint-1', meta, 'mock')).toEqual({ outcome: 'already-completed' });
  });

  it('does not apply concurrently while an event is still (freshly) processing', async () => {
    await claimWebhookEvent('fingerprint-1', meta, 'mock');
    // Still fresh (just claimed) — a second delivery must not proceed to
    // reprocess alongside the first, still-in-flight attempt.
    expect(await claimWebhookEvent('fingerprint-1', meta, 'mock')).toEqual({ outcome: 'currently-processing' });
  });

  it('reclaims a failed event, incrementing attemptCount — a retry after failure is retried, not silently dropped', async () => {
    await claimWebhookEvent('fingerprint-1', meta, 'mock');
    await markWebhookEventFailed('fingerprint-1', 'mock');

    const result = await claimWebhookEvent('fingerprint-1', meta, 'mock');
    expect(result).toEqual({ outcome: 'claimed' });
    expect(webhookEventFixtures.get('fingerprint-1')?.state).toBe('processing');
    expect(webhookEventFixtures.get('fingerprint-1')?.attemptCount).toBe(2);
  });

  it('reclaims a stale "processing" claim (a prior attempt that never reached a terminal state)', async () => {
    await claimWebhookEvent('fingerprint-1', meta, 'mock');
    // Simulate a claim that's been sitting in 'processing' well past the
    // staleness window — e.g. the process crashed mid-request.
    const stale = webhookEventFixtures.get('fingerprint-1')!;
    webhookEventFixtures.set('fingerprint-1', { ...stale, lastAttemptAt: '2020-01-01T00:00:00.000Z' });

    const result = await claimWebhookEvent('fingerprint-1', meta, 'mock');
    expect(result).toEqual({ outcome: 'claimed' });
    expect(webhookEventFixtures.get('fingerprint-1')?.attemptCount).toBe(2);
  });

  it('preserves firstReceivedAt across a reclaim', async () => {
    await claimWebhookEvent('fingerprint-1', meta, 'mock');
    const firstReceivedAt = webhookEventFixtures.get('fingerprint-1')!.firstReceivedAt;
    await markWebhookEventFailed('fingerprint-1', 'mock');
    await claimWebhookEvent('fingerprint-1', meta, 'mock');
    expect(webhookEventFixtures.get('fingerprint-1')!.firstReceivedAt).toBe(firstReceivedAt);
  });

  it('markWebhookEventCompleted sets completedAt', async () => {
    await claimWebhookEvent('fingerprint-1', meta, 'mock');
    await markWebhookEventCompleted('fingerprint-1', 'mock');
    const record = webhookEventFixtures.get('fingerprint-1')!;
    expect(record.state).toBe('completed');
    expect(record.completedAt).not.toBeNull();
  });
});

describe('createPaymentIntegration — mock mode', () => {
  it('adds a new integration to the mock fixture array', async () => {
    const integration = await createPaymentIntegration(
      {
        id: 'new-org-clover',
        organizationId: 'new-org',
        provider: 'clover',
        environment: 'sandbox',
        merchantIdReference: 'CLOVER_NEW_MERCHANT_ID',
        credentialReference: 'CLOVER_NEW_KEY',
        webhookSecretReference: 'CLOVER_NEW_SECRET',
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      'mock',
    );
    expect(integration.organizationId).toBe('new-org');
    expect(await getEnabledIntegration('new-org', 'clover', 'mock')).toMatchObject({ merchantIdReference: 'CLOVER_NEW_MERCHANT_ID' });

    paymentIntegrationFixtures.pop(); // clean up
  });
});
