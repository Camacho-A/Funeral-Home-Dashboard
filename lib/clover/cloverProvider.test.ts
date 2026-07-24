import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloverProvider } from './cloverProvider';
import type { PaymentIntegration, PaymentRecord } from '../../types/payment';

const INTEGRATION: PaymentIntegration = {
  id: 'org-1-clover',
  organizationId: 'org-1',
  provider: 'clover',
  environment: 'sandbox',
  merchantIdReference: 'TEST_CLOVER_MERCHANT_ID',
  credentialReference: 'TEST_CLOVER_PRIVATE_KEY',
  webhookSecretReference: 'TEST_CLOVER_WEBHOOK_SECRET',
  isEnabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const RECORD: PaymentRecord = {
  id: 'payment-1',
  organizationId: 'org-1',
  caseId: 'case-1',
  provider: 'clover',
  providerCheckoutId: 'checkout-1',
  providerPaymentId: null,
  idempotencyKey: 'org-1:key-1',
  checkoutUrl: 'https://apisandbox.dev.clover.com/checkout-1',
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

beforeEach(() => {
  process.env.TEST_CLOVER_MERCHANT_ID = 'merchant-abc';
  process.env.TEST_CLOVER_PRIVATE_KEY = 'fake-private-key';
  process.env.TEST_CLOVER_WEBHOOK_SECRET = 'fake-webhook-secret';
});

afterEach(() => {
  delete process.env.TEST_CLOVER_MERCHANT_ID;
  delete process.env.TEST_CLOVER_PRIVATE_KEY;
  delete process.env.TEST_CLOVER_WEBHOOK_SECRET;
  vi.unstubAllGlobals();
});

describe('cloverProvider.createCheckoutSession', () => {
  it('sends the correct endpoint, headers, and body — a fake transport, never a live Clover call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ href: 'https://apisandbox.dev.clover.com/checkout-1', checkoutSessionId: 'checkout-1', createdTime: 1, expirationTime: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await cloverProvider.createCheckoutSession({
      integration: INTEGRATION,
      amount: 120000,
      currency: 'usd',
      purpose: 'Cremation service fee',
      beaconPaymentId: 'payment-1',
      caseId: 'case-1',
      returnUrl: 'https://beacon.test/return',
      cancelUrl: 'https://beacon.test/cancel',
    });

    expect(result).toEqual({ checkoutUrl: 'https://apisandbox.dev.clover.com/checkout-1', providerCheckoutId: 'checkout-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://apisandbox.dev.clover.com/invoicingcheckoutservice/v1/checkouts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer fake-private-key',
          'X-Clover-Merchant-Id': 'merchant-abc',
        }),
      }),
    );
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.shoppingCart.lineItems[0]).toMatchObject({ name: 'Cremation service fee', price: 120000, unitQty: 1 });
    expect(sentBody.shoppingCart.lineItems[0].note).toContain('payment-1');
  });

  it('never includes the private key anywhere in the request body (only the Authorization header)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ href: 'https://example.test/x', checkoutSessionId: 'c1', createdTime: 1, expirationTime: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cloverProvider.createCheckoutSession({
      integration: INTEGRATION,
      amount: 500,
      currency: 'usd',
      purpose: 'Fee',
      beaconPaymentId: 'p1',
      caseId: 'c1',
      returnUrl: 'https://beacon.test/return',
      cancelUrl: 'https://beacon.test/cancel',
    });

    const sentBody = fetchMock.mock.calls[0][1].body as string;
    expect(sentBody).not.toContain('fake-private-key');
  });

  it('propagates a Clover API failure as a thrown error, never silently swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(
      cloverProvider.createCheckoutSession({
        integration: INTEGRATION,
        amount: 500,
        currency: 'usd',
        purpose: 'Fee',
        beaconPaymentId: 'p1',
        caseId: 'c1',
        returnUrl: 'https://beacon.test/return',
        cancelUrl: 'https://beacon.test/cancel',
      }),
    ).rejects.toThrow();
  });
});

describe('cloverProvider.verifyWebhook', () => {
  function signedRequest(body: string, secret: string, timestamp: number) {
    const hash = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    return new Request('https://beacon.test/api/webhooks/clover', {
      method: 'POST',
      headers: { 'Clover-Signature': `t=${timestamp},v1=${hash}` },
      body,
    });
  }

  it('accepts a validly-signed webhook and returns the parsed payload', () => {
    const body = JSON.stringify({ id: 'pay-1', data: 'checkout-1', status: 'APPROVED', type: 'PAYMENT', merchantId: 'merchant-abc', createdTime: 1 });
    const request = signedRequest(body, 'fake-webhook-secret', Math.floor(Date.now() / 1000));
    const result = cloverProvider.verifyWebhook(body, request.headers, INTEGRATION);
    expect(result.valid).toBe(true);
  });

  it('rejects a webhook signed with the wrong secret', () => {
    const body = JSON.stringify({ id: 'pay-1', data: 'checkout-1', status: 'APPROVED' });
    const request = signedRequest(body, 'attacker-secret', Math.floor(Date.now() / 1000));
    const result = cloverProvider.verifyWebhook(body, request.headers, INTEGRATION);
    expect(result.valid).toBe(false);
  });

  it('rejects a webhook whose signature is valid but body is not JSON', () => {
    const body = 'not-json';
    const timestamp = Math.floor(Date.now() / 1000);
    const hash = createHmac('sha256', 'fake-webhook-secret').update(`${timestamp}.${body}`).digest('hex');
    const request = new Request('https://beacon.test/api/webhooks/clover', {
      headers: { 'Clover-Signature': `t=${timestamp},v1=${hash}` },
    });
    const result = cloverProvider.verifyWebhook(body, request.headers, INTEGRATION);
    expect(result.valid).toBe(false);
  });
});

describe('cloverProvider.mapProviderPayment', () => {
  it('maps an APPROVED event to succeeded', () => {
    const result = cloverProvider.mapProviderPayment({
      id: 'pay-1',
      data: 'checkout-1',
      status: 'APPROVED',
      type: 'PAYMENT',
      merchantId: 'merchant-abc',
      createdTime: 1,
    });
    expect(result.status).toBe('succeeded');
    expect(result.providerPaymentId).toBe('pay-1');
    expect(result.providerCheckoutId).toBe('checkout-1');
    expect(result.failureCode).toBeNull();
  });

  it('maps a DECLINED event to failed, with a failure message', () => {
    const result = cloverProvider.mapProviderPayment({
      id: 'pay-2',
      data: 'checkout-2',
      status: 'DECLINED',
      message: 'Insufficient funds',
      type: 'PAYMENT',
      merchantId: 'merchant-abc',
      createdTime: 1,
    });
    expect(result.status).toBe('failed');
    expect(result.failureCode).toBe('declined');
    expect(result.failureMessage).toBe('Insufficient funds');
  });

  it('never guesses success for an unrecognized status — defaults to pending', () => {
    const result = cloverProvider.mapProviderPayment({
      id: 'pay-3',
      data: 'checkout-3',
      status: 'SOMETHING_NEW',
      type: 'PAYMENT',
      merchantId: 'merchant-abc',
      createdTime: 1,
    });
    expect(result.status).toBe('pending');
  });

  it('throws on an unrecognized payload shape rather than silently returning garbage', () => {
    expect(() => cloverProvider.mapProviderPayment({ foo: 'bar' })).toThrow();
  });
});

describe('cloverProvider.getPaymentStatus', () => {
  it('returns null when no providerPaymentId is known yet (webhook has not fired)', async () => {
    const result = await cloverProvider.getPaymentStatus(INTEGRATION, RECORD);
    expect(result).toBeNull();
  });

  it('queries the standard Clover payments endpoint once a providerPaymentId is known', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'pay-1', result: 'SUCCESS', cardTransaction: { cardType: 'visa', last4: '4242' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await cloverProvider.getPaymentStatus(INTEGRATION, { ...RECORD, providerPaymentId: 'pay-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://apisandbox.dev.clover.com/v3/merchants/merchant-abc/payments/pay-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toMatchObject({ status: 'succeeded', cardBrand: 'visa', cardLast4: '4242' });
  });
});
