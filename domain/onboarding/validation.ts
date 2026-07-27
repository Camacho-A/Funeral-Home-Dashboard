import { isValidEmail, isValidPhoneNumber } from '../../utils/inputMask';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Centralized
 * onboarding field validation — the one place a step's raw input is
 * checked before `services/organizationProvisioningService.ts` persists
 * anything. Returns field-specific errors (`{ field, message }`) rather
 * than a single boolean/string, per this phase's own "Return
 * field-specific validation errors for the UI" requirement. Reuses
 * `utils/inputMask.ts`'s existing `isValidEmail`/`isValidPhoneNumber`
 * rather than re-deriving new ones.
 */
export type FieldValidationError = { field: string; message: string };

export function isValidTimezone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Shape-only, matching the same `/^[a-z]{3}$/` convention the Clover
    checkout route already uses for `currency` — not a lookup against a
    real ISO 4217 table. */
export function isValidCurrencyCode(value: string): boolean {
  return /^[a-z]{3}$/.test(value.trim().toLowerCase());
}

export type OrganizationProfileInput = {
  legalName?: unknown;
  displayName?: unknown;
  primaryEmail?: unknown;
  primaryPhone?: unknown;
  website?: unknown;
  timezone?: unknown;
  defaultCurrency?: unknown;
};

export function validateOrganizationProfile(input: OrganizationProfileInput): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  if (typeof input.legalName !== 'string' || input.legalName.trim().length === 0) {
    errors.push({ field: 'legalName', message: 'Legal name is required.' });
  }
  if (typeof input.displayName !== 'string' || input.displayName.trim().length === 0) {
    errors.push({ field: 'displayName', message: 'Display name is required.' });
  }
  if (typeof input.primaryEmail !== 'string' || !isValidEmail(input.primaryEmail)) {
    errors.push({ field: 'primaryEmail', message: 'A valid business email is required.' });
  }
  if (typeof input.primaryPhone !== 'string' || !isValidPhoneNumber(input.primaryPhone)) {
    errors.push({ field: 'primaryPhone', message: 'A valid business phone number is required.' });
  }
  if (input.website !== undefined && input.website !== null && input.website !== '' && typeof input.website !== 'string') {
    errors.push({ field: 'website', message: 'Website must be a string.' });
  }
  if (typeof input.timezone !== 'string' || !isValidTimezone(input.timezone)) {
    errors.push({ field: 'timezone', message: 'A valid timezone is required.' });
  }
  if (typeof input.defaultCurrency !== 'string' || !isValidCurrencyCode(input.defaultCurrency)) {
    errors.push({ field: 'defaultCurrency', message: 'A valid 3-letter currency code is required.' });
  }

  return errors;
}

export type PrimaryLocationInput = {
  name?: unknown;
  addressLine1?: unknown;
  city?: unknown;
  state?: unknown;
  postalCode?: unknown;
  country?: unknown;
  phone?: unknown;
  email?: unknown;
};

export function validatePrimaryLocation(input: PrimaryLocationInput): FieldValidationError[] {
  const errors: FieldValidationError[] = [];
  const requiredStringFields: Array<[keyof PrimaryLocationInput, string]> = [
    ['name', 'Location name is required.'],
    ['addressLine1', 'Address is required.'],
    ['city', 'City is required.'],
    ['state', 'State is required.'],
    ['postalCode', 'Postal code is required.'],
    ['country', 'Country is required.'],
  ];
  for (const [field, message] of requiredStringFields) {
    if (typeof input[field] !== 'string' || (input[field] as string).trim().length === 0) {
      errors.push({ field, message });
    }
  }
  if (typeof input.phone !== 'string' || !isValidPhoneNumber(input.phone)) {
    errors.push({ field: 'phone', message: 'A valid phone number is required.' });
  }
  if (input.email !== undefined && input.email !== null && input.email !== '' && !isValidEmail(String(input.email))) {
    errors.push({ field: 'email', message: 'Email must be a valid address.' });
  }
  return errors;
}
