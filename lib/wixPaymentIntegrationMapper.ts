import type { PaymentIntegration } from '../types/payment';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Mirrors
 * lib/wixCaseMapper.ts's role for a new `paymentIntegrations` collection —
 * the one place a raw Wix item for it is ever touched. See
 * docs/WIX_DATA_SCHEMA.md and docs/adr/ADR-022-clover-hosted-checkout-integration.md.
 *
 * `merchantIdReference`/`credentialReference`/`webhookSecretReference` are
 * all stored as plain text here — they are environment-variable *names*,
 * never the values those names point to (lib/clover/cloverConfig.ts
 * resolves the actual values). Nothing in this file, or anything that
 * calls it, ever reads or writes a literal Clover merchant id, private
 * key, or webhook secret.
 */

export type WixPaymentIntegrationItem = {
  beaconIntegrationId?: unknown;
  organizationId?: unknown;
  provider?: unknown;
  environment?: unknown;
  merchantIdReference?: unknown;
  credentialReference?: unknown;
  webhookSecretReference?: unknown;
  isEnabled?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function mapWixPaymentIntegrationItem(item: WixPaymentIntegrationItem | undefined): PaymentIntegration | null {
  if (
    !item ||
    typeof item.beaconIntegrationId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.provider !== 'string' ||
    (item.environment !== 'sandbox' && item.environment !== 'production') ||
    typeof item.merchantIdReference !== 'string' ||
    typeof item.credentialReference !== 'string' ||
    typeof item.webhookSecretReference !== 'string' ||
    typeof item.isEnabled !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: item.beaconIntegrationId,
    organizationId: item.organizationId,
    provider: item.provider,
    environment: item.environment,
    merchantIdReference: item.merchantIdReference,
    credentialReference: item.credentialReference,
    webhookSecretReference: item.webhookSecretReference,
    isEnabled: item.isEnabled,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildWixPaymentIntegrationData(integration: PaymentIntegration): WixPaymentIntegrationItem {
  return {
    beaconIntegrationId: integration.id,
    organizationId: integration.organizationId,
    provider: integration.provider,
    environment: integration.environment,
    merchantIdReference: integration.merchantIdReference,
    credentialReference: integration.credentialReference,
    webhookSecretReference: integration.webhookSecretReference,
    isEnabled: integration.isEnabled,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
}
