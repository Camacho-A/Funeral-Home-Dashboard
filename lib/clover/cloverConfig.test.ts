import { afterEach, describe, expect, it } from 'vitest';
import { getCloverMerchantId, getCloverPrivateKey, getCloverWebhookSecret, isValidCloverReference } from './cloverConfig';
import type { PaymentIntegration } from '../../types/payment';

/** Multi-tenant hardening (2026-11): a payment integration row can only
    name Clover variables, never another server secret. Fictional values. */
const integration = (refs: Partial<PaymentIntegration>): PaymentIntegration => ({
  id: 'fictional-home-clover', organizationId: 'fictional-home', provider: 'clover', environment: 'sandbox',
  merchantIdReference: 'CLOVER_FICTIONAL_MERCHANT_ID', credentialReference: 'CLOVER_FICTIONAL_PRIVATE_KEY', webhookSecretReference: 'CLOVER_FICTIONAL_WEBHOOK_SECRET',
  isEnabled: false, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', ...refs,
});

afterEach(() => {
  delete process.env.CLOVER_FICTIONAL_MERCHANT_ID;
  delete process.env.FICTIONAL_OTHER_SECRET;
});

describe('Clover credential references', () => {
  it('accepts only CLOVER_ variable names (including the names Manors uses)', () => {
    expect(isValidCloverReference('CLOVER_MANORS_SANDBOX_MERCHANT_ID')).toBe(true);
    expect(isValidCloverReference('CLOVER_MANORS_SANDBOX_PRIVATE_KEY')).toBe(true);
    for (const bad of ['WIX_API_KEY', 'RESEND_API_KEY', 'clover_lower', 'CLOVER_', 'CLOVER_X;rm', '', null, 42]) expect(isValidCloverReference(bad)).toBe(false);
  });

  it('resolves a Clover variable', () => {
    process.env.CLOVER_FICTIONAL_MERCHANT_ID = 'fictional-merchant';
    expect(getCloverMerchantId(integration({}))).toBe('fictional-merchant');
  });

  it('refuses to read any other server secret, even when it is set', () => {
    process.env.FICTIONAL_OTHER_SECRET = 'must-never-leave-the-server';
    for (const read of [
      () => getCloverMerchantId(integration({ merchantIdReference: 'FICTIONAL_OTHER_SECRET' })),
      () => getCloverPrivateKey(integration({ credentialReference: 'FICTIONAL_OTHER_SECRET' })),
      () => getCloverWebhookSecret(integration({ webhookSecretReference: 'FICTIONAL_OTHER_SECRET' })),
    ]) {
      expect(read).toThrow(/not a Clover variable name/);
      try { read(); } catch (error) { expect(String(error)).not.toContain('must-never-leave-the-server'); }
    }
  });
});
