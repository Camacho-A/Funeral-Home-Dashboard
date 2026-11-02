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

/**
 * Multi-tenant hardening (2026-11). A reference may only name a variable in
 * the Clover family (`CLOVER_…`, upper-case). Without this, a payment
 * integration row naming e.g. `WIX_API_KEY` would make the server send that
 * secret to Clover as a bearer token. Every Clover variable SOLIS uses
 * (`CLOVER_MANORS_SANDBOX_*`, .env.example) already matches.
 */
export const CLOVER_REFERENCE_PATTERN = /^CLOVER_[A-Z0-9_]+$/;

export function isValidCloverReference(name: unknown): name is string {
  return typeof name === 'string' && CLOVER_REFERENCE_PATTERN.test(name);
}

function readCloverReference(integration: PaymentIntegration, name: string, what: string): string | undefined {
  if (!isValidCloverReference(name)) {
    throw new Error(
      `Clover integration for organization ${integration.organizationId} references ${what} "${name}", ` +
        'which is not a Clover variable name (CLOVER_…). Refused — nothing was sent.',
    );
  }
  return process.env[name];
}

export function getCloverMerchantId(integration: PaymentIntegration): string {
  const value = readCloverReference(integration, integration.merchantIdReference, 'merchant id');
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
  const value = readCloverReference(integration, integration.credentialReference, 'credential');
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
  const value = readCloverReference(integration, integration.webhookSecretReference, 'webhook secret');
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
