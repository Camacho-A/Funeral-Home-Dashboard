import type { PaymentIntegration } from '../../types/payment';

/**
 * Phase 19B (Clover Hosted Checkout Integration). Resolves a
 * `PaymentIntegration`'s `merchantIdReference`/`credentialReference`/
 * `webhookSecretReference` (env var *names*) into their actual values —
 * the one place any of the three is ever read. Never logs the resolved
 * value; every error message names the missing *variable*, never its
 * (absent) content, matching lib/env.ts's existing "fail clearly, never
 * leak" convention.
 *
 * This indirection (a PaymentIntegration row stores a variable *name*,
 * not the value) is deliberate: a future per-organization encrypted
 * secret store can replace the body of these functions with a real
 * lookup, without any change to PaymentIntegration's shape or any caller.
 */

export function getCloverMerchantId(integration: PaymentIntegration): string {
  const value = process.env[integration.merchantIdReference];
  if (!value) {
    throw new Error(
      `Clover integration for organization ${integration.organizationId} references merchant id ` +
        `"${integration.merchantIdReference}", which is not set. Set it in .env.local (server-only), ` +
        'or disable this PaymentIntegration until it is.',
    );
  }
  return value;
}

export function getCloverPrivateKey(integration: PaymentIntegration): string {
  const value = process.env[integration.credentialReference];
  if (!value) {
    throw new Error(
      `Clover integration for organization ${integration.organizationId} references credential ` +
        `"${integration.credentialReference}", which is not set. Set it in .env.local (server-only), ` +
        'or disable this PaymentIntegration until it is.',
    );
  }
  return value;
}

export function getCloverWebhookSecret(integration: PaymentIntegration): string {
  const value = process.env[integration.webhookSecretReference];
  if (!value) {
    throw new Error(
      `Clover integration for organization ${integration.organizationId} references webhook secret ` +
        `"${integration.webhookSecretReference}", which is not set. Set it in .env.local (server-only), ` +
        'or disable this PaymentIntegration until it is.',
    );
  }
  return value;
}

/**
 * Sandbox vs. production API hostnames — confirmed from Clover's own
 * Hosted Checkout documentation (docs.clover.com/dev/docs/creating-a-hosted-checkout-session).
 */
export function getCloverApiBaseUrl(environment: PaymentIntegration['environment']): string {
  return environment === 'production' ? 'https://api.clover.com' : 'https://apisandbox.dev.clover.com';
}
