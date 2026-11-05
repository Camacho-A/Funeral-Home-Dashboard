import { GATEWAY_DOMAINS } from './faxSettings';

/**
 * Fax Settings (2026-11) — the email-to-fax providers SOLIS can send
 * through, behind one narrow interface. A provider turns a 10-digit fax
 * number into the email address its gateway faxes from, and says which
 * optional email features are known to be safe with it.
 *
 * Capabilities are facts about the provider, verified by a controlled test,
 * never settings: an organization cannot switch one on.
 *   'supported'   — verified; the feature may be enabled and used;
 *   'unverified'  — not yet proven; it may be drafted but is never used;
 *   'unsupported' — the provider has no such option; never offered.
 *
 * Plain const registry, no factory — the same pattern as the other
 * provider-neutral interfaces (lib/paymentProvider.ts and friends).
 */
export type FaxCapability = 'supported' | 'unverified' | 'unsupported';

export type FaxProviderKey = 'nuso';

export interface FaxProvider {
  key: FaxProviderKey;
  /** Shown to administrators. */
  label: string;
  /** The gateway's email domain. Must be on GATEWAY_DOMAINS. */
  gatewayDomain: string;
  /** May the email carry a message body? */
  emailBody: FaxCapability;
  /** Can the provider add its own cover page? SOLIS never generates one. */
  coverPage: FaxCapability;
  /** Plain words for the settings page — why each capability is what it is. */
  notes: string;
}

export const nusoIpFaxProvider: FaxProvider = {
  key: 'nuso',
  label: 'NuSo IPFax',
  gatewayDomain: 'fax.nuso.io',
  // A controlled Outlook test (2026-11) turned a one-page PDF sent with a
  // message and signature into a three-page fax: body text became pages.
  emailBody: 'unverified',
  // No provider-side cover page option has been verified for NuSo's
  // email-to-fax gateway.
  coverPage: 'unsupported',
  notes:
    'Email-to-fax: the email goes to {fax number}@fax.nuso.io and NuSo faxes its attachment. A controlled test showed that message text and a signature are faxed as extra pages, so the message body stays off until a test proves otherwise. NuSo has no verified cover page option.',
};

export const FAX_PROVIDERS: Readonly<Record<FaxProviderKey, FaxProvider>> = { nuso: nusoIpFaxProvider };

export const DEFAULT_FAX_PROVIDER_KEY: FaxProviderKey = 'nuso';

export function isFaxProviderKey(value: unknown): value is FaxProviderKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FAX_PROVIDERS, value);
}

/** The provider, or null for an unknown key. Its gateway must still be an approved one. */
export function faxProvider(key: unknown): FaxProvider | null {
  if (!isFaxProviderKey(key)) return null;
  const provider = FAX_PROVIDERS[key];
  return GATEWAY_DOMAINS.includes(provider.gatewayDomain) ? provider : null;
}

/** Only a verified capability may be used. */
export const canUse = (capability: FaxCapability) => capability === 'supported';

/** Shown wherever a body, signature or cover page could be turned on. */
export const EXTRA_PAGES_WARNING =
  'An email message, a signature or a cover page can be faxed as extra pages, depending on the provider. SOLIS sends the bundle with no message and never adds a signature or a cover page unless the provider has been verified to handle them.';
