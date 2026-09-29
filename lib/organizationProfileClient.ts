/**
 * Settings → Organization Profile (2026-09). Client-side fetch wrappers
 * around `/api/organization/profile` — mirrors every other `lib/*Client.ts`
 * file's shape (e.g. `lib/caseNumberingClient.ts`). `organizationProvisioningService.ts`
 * can never be called from a Client Component directly.
 */

export type OrganizationProfileFields = {
  name: string;
  legalName: string;
  primaryEmail: string;
  primaryPhone: string;
  website: string | null;
};

export type PrimaryLocationFields = {
  name: string;
  locationType: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string | null;
};

export type OrganizationProfile = {
  organization: OrganizationProfileFields;
  location: PrimaryLocationFields | null;
};

export type FieldValidationError = { field: string; message: string };

export class OrganizationProfileValidationError extends Error {
  fieldErrors: FieldValidationError[];
  constructor(message: string, fieldErrors: FieldValidationError[]) {
    super(message);
    this.name = 'OrganizationProfileValidationError';
    this.fieldErrors = fieldErrors;
  }
}

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    if (Array.isArray(body.fieldErrors)) {
      throw new OrganizationProfileValidationError(message, body.fieldErrors as FieldValidationError[]);
    }
    throw new Error(message);
  }
  return body;
}

export async function fetchOrganizationProfile(organizationId: string): Promise<OrganizationProfile> {
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/organization/profile?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return body as unknown as OrganizationProfile;
}

export async function updateOrganizationProfile(
  organizationId: string,
  organization: Partial<OrganizationProfileFields>,
): Promise<OrganizationProfileFields> {
  const response = await fetch('/api/organization/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, organization }),
  });
  const body = await parseJsonOrThrow(response);
  return body.organization as OrganizationProfileFields;
}

export async function updatePrimaryLocationProfile(
  organizationId: string,
  location: Partial<PrimaryLocationFields>,
): Promise<PrimaryLocationFields> {
  const response = await fetch('/api/organization/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, location }),
  });
  const body = await parseJsonOrThrow(response);
  return body.location as PrimaryLocationFields;
}
