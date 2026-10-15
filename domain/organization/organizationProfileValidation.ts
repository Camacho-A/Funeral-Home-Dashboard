import { isValidEmail, isValidPhoneNumber } from '../../utils/inputMask';
import { validatePrimaryLocation, type FieldValidationError, type PrimaryLocationInput } from '../onboarding/validation';
import type { OrganizationLocationType } from '../../types/organizationLocation';
import { isValidCaseNumberPrefix } from '../cases/caseNumber';

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

/**
 * Organization-specific case numbering (2026-10). Validates a requested
 * `caseNumberPrefix` value: 1-3 letters A-Z. Lower-case input is accepted
 * and normalized to upper case (returned as `normalized`); anything else
 * (digits, punctuation, empty, 4+ letters) is rejected — never silently
 * replaced with a default.
 */
export function validateCaseNumberPrefixValue(value: unknown): { errors: FieldValidationError[]; normalized: string | null } {
  if (typeof value !== 'string') {
    return { errors: [{ field: 'caseNumberPrefix', message: 'Case number prefix is required and must be text.' }], normalized: null };
  }
  const normalized = value.trim().toUpperCase();
  if (!isValidCaseNumberPrefix(normalized)) {
    return {
      errors: [{ field: 'caseNumberPrefix', message: 'Case number prefix must be 1 to 3 letters (A-Z), e.g. "M".' }],
      normalized: null,
    };
  }
  return { errors: [], normalized };
}

/**
 * The rule that protects existing case numbers when a prefix changes.
 *
 * Existing case numbers are NEVER rewritten, so changing the prefix of an
 * organization that already has cases would split its history across two
 * prefixes (and make prefix-aware parsing — resync probing, historical
 * import checks — disagree with the stored numbers). Therefore a prefix
 * may only be CHANGED while the organization has no cases at all; setting
 * the prefix it already effectively uses is always allowed (a no-op that
 * merely records it explicitly). Returns the blocking error, or null.
 */
export function validateCaseNumberPrefixChange(params: {
  requestedPrefix: string;
  currentEffectivePrefix: string;
  existingCaseCount: number;
}): FieldValidationError | null {
  if (params.requestedPrefix === params.currentEffectivePrefix) return null;
  if (params.existingCaseCount > 0) {
    return {
      field: 'caseNumberPrefix',
      message: `The case number prefix cannot be changed from "${params.currentEffectivePrefix}" to "${params.requestedPrefix}" because this organization already has cases. Existing case numbers are never renumbered.`,
    };
  }
  return null;
}
