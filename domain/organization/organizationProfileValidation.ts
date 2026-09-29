import { isValidEmail, isValidPhoneNumber } from '../../utils/inputMask';
import { validatePrimaryLocation, type FieldValidationError, type PrimaryLocationInput } from '../onboarding/validation';
import type { OrganizationLocationType } from '../../types/organizationLocation';

export type { FieldValidationError };

/**
 * Settings → Organization Profile (2026-09). Server-side validation for
 * the two editable sections — reuses `domain/onboarding/validation.ts`'s
 * `validatePrimaryLocation` (identical required-ness for the address
 * fields) and `utils/inputMask.ts`'s `isValidEmail`/`isValidPhoneNumber`
 * rather than re-deriving competing rules; only adds what onboarding's
 * validator doesn't already cover (a reasonable name length, an optional
 * legalName, and `locationType`, which the onboarding flow never collects
 * — see `PrimaryLocationStep.tsx`, which defaults it to `'office'`
 * without asking).
 */

const MAX_ORGANIZATION_NAME_LENGTH = 200;

/** Shape-only check (protocol + parseable), matching this codebase's own
    "shape-only, not a real registry lookup" convention (see
    `isValidCurrencyCode`'s own comment). Empty is valid — website is
    optional. */
export function isValidWebsiteUrl(value: string): boolean {
  if (value.trim() === '') return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export type OrganizationProfileUpdateInput = {
  name?: unknown;
  legalName?: unknown;
  primaryEmail?: unknown;
  primaryPhone?: unknown;
  website?: unknown;
};

export function validateOrganizationProfileUpdate(input: OrganizationProfileUpdateInput): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    errors.push({ field: 'name', message: 'Organization name is required.' });
  } else if (input.name.trim().length > MAX_ORGANIZATION_NAME_LENGTH) {
    errors.push({ field: 'name', message: `Organization name must be ${MAX_ORGANIZATION_NAME_LENGTH} characters or fewer.` });
  }

  if (input.legalName !== undefined && input.legalName !== null && typeof input.legalName !== 'string') {
    errors.push({ field: 'legalName', message: 'Legal name must be text.' });
  }

  if (input.primaryEmail !== undefined && input.primaryEmail !== null) {
    if (typeof input.primaryEmail !== 'string' || !isValidEmail(input.primaryEmail)) {
      errors.push({ field: 'primaryEmail', message: 'Primary email must be a valid email address.' });
    }
  }

  if (input.primaryPhone !== undefined && input.primaryPhone !== null) {
    if (typeof input.primaryPhone !== 'string' || !isValidPhoneNumber(input.primaryPhone)) {
      errors.push({ field: 'primaryPhone', message: 'Primary phone must be a valid phone number.' });
    }
  }

  if (input.website !== undefined && input.website !== null) {
    if (typeof input.website !== 'string' || !isValidWebsiteUrl(input.website)) {
      errors.push({ field: 'website', message: 'Website must be a valid http:// or https:// URL.' });
    }
  }

  return errors;
}

const VALID_LOCATION_TYPES: readonly OrganizationLocationType[] = ['office', 'funeral_home', 'crematory', 'mailing_only'];

export type PrimaryLocationUpdateInput = PrimaryLocationInput & { locationType?: unknown; addressLine2?: unknown };

export function validatePrimaryLocationUpdate(input: PrimaryLocationUpdateInput): FieldValidationError[] {
  const errors = validatePrimaryLocation(input);

  if (typeof input.locationType !== 'string' || !(VALID_LOCATION_TYPES as readonly string[]).includes(input.locationType)) {
    errors.push({ field: 'locationType', message: `Location type must be one of: ${VALID_LOCATION_TYPES.join(', ')}.` });
  }

  if (input.addressLine2 !== undefined && input.addressLine2 !== null && typeof input.addressLine2 !== 'string') {
    errors.push({ field: 'addressLine2', message: 'Address line 2 must be text.' });
  }

  return errors;
}
