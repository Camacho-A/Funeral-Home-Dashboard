import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';

/**
 * Send to Crematory (2026-10). Each organization's own crematory
 * recipients, entered by an administrator — never a built-in address.
 * Staff can still change the recipients of any single email before sending.
 */
export type CrematorySettings = { to: string[]; cc: string[] };

export const EMPTY_CREMATORY_SETTINGS: CrematorySettings = { to: [], cc: [] };
const MAX_RECIPIENTS = 10;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

export function isEmailAddress(value: string): boolean {
  return EMAIL.test(value.trim());
}

/** Splits "a@x.com; b@y.com, c@z.com" into addresses. */
export function parseRecipientList(value: string): string[] {
  return value.split(/[;,\s]+/).map((part) => part.trim()).filter(Boolean);
}

export class CrematorySettingsError extends Error {}

/** Validated, trimmed, de-duplicated recipients. Throws naming what is wrong. */
export function normalizeRecipients(raw: { to?: unknown; cc?: unknown }, options: { requireTo: boolean }): CrematorySettings {
  const list = (value: unknown, label: string): string[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new CrematorySettingsError(`${label} must be a list of email addresses.`);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const address of (value as string[]).map((v) => v.trim()).filter(Boolean)) {
      if (!isEmailAddress(address)) throw new CrematorySettingsError(`"${address}" is not a valid email address.`);
      if (!seen.has(address.toLowerCase())) {
        seen.add(address.toLowerCase());
        out.push(address);
      }
    }
    if (out.length > MAX_RECIPIENTS) throw new CrematorySettingsError(`${label} can have at most ${MAX_RECIPIENTS} addresses.`);
    return out;
  };
  const to = list(raw.to, 'To');
  const cc = list(raw.cc, 'CC').filter((address) => !to.some((t) => t.toLowerCase() === address.toLowerCase()));
  if (options.requireTo && to.length === 0) throw new CrematorySettingsError('Enter at least one crematory email address.');
  return { to, cc };
}

/** The stored settings, or empty ones — never throws on old or odd data. */
export function resolveCrematorySettings(stored: unknown): CrematorySettings {
  if (typeof stored !== 'object' || stored === null) return EMPTY_CREMATORY_SETTINGS;
  try {
    return normalizeRecipients(stored as { to?: unknown; cc?: unknown }, { requireTo: false });
  } catch {
    return EMPTY_CREMATORY_SETTINGS;
  }
}

export function sendToCrematoryConfig(organizationId: string | null | undefined) {
  return organizationId ? getRegisteredOrganizationProfile(organizationId).features.sendToCrematory : null;
}
