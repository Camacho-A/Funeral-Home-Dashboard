import type { FaxProviderKey } from './faxProviders';

/**
 * Fax Settings (2026-11) — what each organization configures for faxing.
 *
 * Two kinds of record, both organization-scoped (never shared):
 *   FaxDestination      — an agency's fax number. Many per organization.
 *                         Editable and archivable, never deleted; every
 *                         change bumps `revision` and is conditioned on it.
 *   FaxSettingsRecord   — ONE per organization (fixed id): the provider, the
 *                         default destination, the subject and message
 *                         templates and the cover page choice. Also
 *                         revision-conditioned.
 *
 * The default destination is a single pointer on the settings record
 * (`defaultDestinationId`), not a flag on each destination: one
 * conditioned write moves it, so two administrators can never leave two
 * defaults (or none) behind. A destination's `isDefault` is derived.
 *
 * NOT settings, ever: whether faxes may be SENT (`sendingEnabled`), the
 * attachment size limit, and which providers exist and what they support.
 * Those live in code (the organization profile and faxProviders.ts) so only
 * a reviewed deploy can change them.
 *
 * A prepared bundle snapshots the destination, provider, subject and
 * message it was previewed with; settings changes never alter it, and Send
 * Fax refuses (nothing sent) when the settings no longer match it.
 */

export const FAX_CONFIGURATION_RECORD_VERSION = 1;

export type FaxDestinationStatus = 'active' | 'archived';

export type FaxDestination = {
  id: string;
  organizationId: string;
  /** e.g. "Manatee County Vital Statistics". */
  name: string;
  /** 10 digits, US/Canada. */
  faxNumber: string;
  providerKey: FaxProviderKey;
  /** Free text, e.g. "Death certificate applications". */
  purpose: string;
  status: FaxDestinationStatus;
  revision: number;
  recordVersion: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
};

export type FaxSettingsRecord = {
  id: string;
  organizationId: string;
  providerKey: FaxProviderKey;
  defaultDestinationId: string | null;
  subjectTemplate: string;
  bodyEnabled: boolean;
  bodyTemplate: string;
  coverPageEnabled: boolean;
  revision: number;
  recordVersion: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export const DESTINATION_NAME_MAX = 100;
export const DESTINATION_PURPOSE_MAX = 100;

export class FaxConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaxConfigurationError';
  }
}

/**
 * "941-554-5490", "(941) 554-5490", "+1 941 554 5490" → "9415545490".
 * A North American number: area code and exchange cannot start with 0 or 1.
 */
export function normalizeFaxNumber(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new FaxConfigurationError('The fax number is required.');
  if (/[^\d\s().+\-]/.test(value)) throw new FaxConfigurationError('The fax number can contain only digits, spaces, dashes, dots and parentheses.');
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) throw new FaxConfigurationError('The fax number must be a 10-digit US or Canadian number, e.g. 941-554-5490.');
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) throw new FaxConfigurationError('That is not a valid fax number: the area code and the next three digits cannot start with 0 or 1.');
  return digits;
}

export function normalizeDestinationName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new FaxConfigurationError('The destination name is required.');
  if (name.length > DESTINATION_NAME_MAX) throw new FaxConfigurationError(`The destination name can be at most ${DESTINATION_NAME_MAX} characters.`);
  if (/[\u0000-\u001f\u007f<>]/.test(name)) throw new FaxConfigurationError('The destination name must be plain text.');
  return name;
}

export function normalizeDestinationPurpose(value: unknown): string {
  if (value === undefined || value === null) return '';
  const purpose = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (purpose.length > DESTINATION_PURPOSE_MAX) throw new FaxConfigurationError(`The purpose can be at most ${DESTINATION_PURPOSE_MAX} characters.`);
  if (/[\u0000-\u001f\u007f<>]/.test(purpose)) throw new FaxConfigurationError('The purpose must be plain text.');
  return purpose;
}
