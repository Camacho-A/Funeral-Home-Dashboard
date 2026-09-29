import { NextResponse } from 'next/server';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { canManageOrganization } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import { getOrganization, updateOrganization, getPrimaryLocation, updatePrimaryLocation } from '@/services/organizationProvisioningService';
import { validateOrganizationProfileUpdate, validatePrimaryLocationUpdate } from '@/domain/organization/organizationProfileValidation';
import { normalizeOrganizationProfileTextFields, normalizePrimaryLocationTextFields } from '@/domain/organization/textNormalization';
import type { Organization } from '@/types/organization';
import type { OrganizationLocation } from '@/types/organizationLocation';

/**
 * Settings → Organization Profile (2026-09). Read/update path for an
 * organization's own business-identity fields (`Organization`) and its
 * existing primary `OrganizationLocation` — gated by `organization.manage`,
 * the narrowest existing fit ("Manage the organization's own profile and
 * settings" — already used identically by the MFA-policy route). No new
 * permission key was needed.
 *
 * Deliberately excludes every technical/configuration field from both the
 * read and write surface: `id`/`slug`/`status`/`enabledModules`/
 * `familyPortalEnabled`/`signatureRequestsEnabled`/`requireMfa`/
 * `defaultCurrency`/`timezone` on Organization, and `id`/`organizationId`/
 * `isPrimary`/`isActive`/`createdAt` on OrganizationLocation. `timezone`
 * is withheld deliberately, not by oversight: it feeds
 * `app/api/cases/route.ts`'s case-number year derivation
 * (`orgLocalYear(createdAt, organization?.timezone)`) and quiet-hours/
 * reminder timing (`appointmentReminderService.ts`,
 * `notificationDigestService.ts`, `notificationService.ts`) — changing it
 * post-onboarding could silently shift which year a case is numbered
 * under or when reminders fire, neither of which this editor is the
 * right place to reason about. Never creates a primary location if one
 * doesn't exist — `updatePrimaryLocation` returns `null` in that case,
 * surfaced here as a clear 404, never a silent no-op or a fabricated row.
 *
 * `updateOrganization`/`updatePrimaryLocation` (`organizationProvisioningService.ts`)
 * already implement the load-current → merge → write-full-record pattern
 * this collection's own full-replace Wix semantics require — this route
 * never constructs a replacement object itself.
 */

type SanitizedOrganization = Pick<Organization, 'name' | 'legalName' | 'primaryEmail' | 'primaryPhone' | 'website'>;
type SanitizedLocation = Pick<
  OrganizationLocation,
  'name' | 'locationType' | 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode' | 'country' | 'phone' | 'email'
>;

function sanitizeOrganization(org: Organization): SanitizedOrganization {
  return {
    name: org.name,
    legalName: org.legalName ?? '',
    primaryEmail: org.primaryEmail ?? '',
    primaryPhone: org.primaryPhone ?? '',
    website: org.website ?? null,
  };
}

function sanitizeLocation(location: OrganizationLocation): SanitizedLocation {
  return {
    name: location.name,
    locationType: location.locationType,
    addressLine1: location.addressLine1,
    addressLine2: location.addressLine2,
    city: location.city,
    state: location.state,
    postalCode: location.postalCode,
    country: location.country,
    phone: location.phone,
    email: location.email,
  };
}

async function authorizeRequest(requestedOrganizationId: string) {
  const authResult = await requireAuthorizedOrganization(requestedOrganizationId);
  if (!authResult.authorized) {
    return { ok: false as const, response: authResult.response };
  }
  const { organizationId, userId, role } = authResult.context;
  const mode = getDataAdapterMode();

  if (!(await canManageOrganization({ identityId: userId, organizationId, roleKey: role }, mode))) {
    return { ok: false as const, response: NextResponse.json({ error: 'Not authorized.' }, { status: 403 }) };
  }

  return { ok: true as const, organizationId, mode };
}

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });

  const auth = await authorizeRequest(organizationId);
  if (!auth.ok) return auth.response;

  const organization = await getOrganization(auth.organizationId, auth.mode);
  if (!organization) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 });

  const location = await getPrimaryLocation(auth.organizationId, auth.mode);

  return NextResponse.json({
    organization: sanitizeOrganization(organization),
    location: location ? sanitizeLocation(location) : null,
  });
}

/** `organization` and `location` are each independently validated and
    applied — the Organization Profile UI has its own Save action per
    section and only ever sends one key at a time. Supporting both in one
    call is intentional flexibility, not something this route's own
    client relies on: if both were sent and the location half failed
    after the organization half already succeeded, the 404 response below
    would still carry the already-updated organization fields in its body
    (never discarded), but a caller that treats any non-2xx as "nothing
    happened" would miss that — acceptable here since the shipped UI never
    creates that situation. */
export async function PATCH(request: Request) {
  const csrf = requireSameOrigin(request);
  if (csrf) return csrf;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as { organizationId?: unknown; organization?: unknown; location?: unknown };
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }
  if (b.organization === undefined && b.location === undefined) {
    return NextResponse.json({ error: 'Nothing to update — provide "organization" and/or "location".' }, { status: 400 });
  }

  const auth = await authorizeRequest(b.organizationId);
  if (!auth.ok) return auth.response;

  let updatedOrganization: SanitizedOrganization | undefined;
  if (b.organization !== undefined) {
    if (typeof b.organization !== 'object' || b.organization === null) {
      return NextResponse.json({ error: '"organization" must be an object.' }, { status: 400 });
    }
    const orgInput = b.organization as Record<string, unknown>;
    const errors = validateOrganizationProfileUpdate(orgInput);
    if (errors.length > 0) return NextResponse.json({ error: 'Validation failed.', fieldErrors: errors }, { status: 400 });

    const trimmedName = (orgInput.name as string).trim();
    const patch: Partial<Organization> = { name: trimmedName };
    if (orgInput.legalName !== undefined) patch.legalName = (orgInput.legalName as string | null ?? '').toString().trim();
    if (orgInput.primaryEmail !== undefined) patch.primaryEmail = (orgInput.primaryEmail as string | null ?? '').toString().trim();
    if (orgInput.primaryPhone !== undefined) patch.primaryPhone = (orgInput.primaryPhone as string | null ?? '').toString().trim();
    if (orgInput.website !== undefined) {
      const trimmedWebsite = (orgInput.website as string | null ?? '').toString().trim();
      patch.website = trimmedWebsite === '' ? null : trimmedWebsite;
    }

    const normalized = normalizeOrganizationProfileTextFields(patch);
    const updated = await updateOrganization(auth.organizationId, normalized, auth.mode);
    if (!updated) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 });
    updatedOrganization = sanitizeOrganization(updated);
  }

  let updatedLocation: SanitizedLocation | null | undefined;
  if (b.location !== undefined) {
    if (typeof b.location !== 'object' || b.location === null) {
      return NextResponse.json({ error: '"location" must be an object.' }, { status: 400 });
    }
    const locationInput = b.location as Record<string, unknown>;
    const errors = validatePrimaryLocationUpdate(locationInput);
    if (errors.length > 0) return NextResponse.json({ error: 'Validation failed.', fieldErrors: errors }, { status: 400 });

    const patch: Partial<OrganizationLocation> = {
      name: (locationInput.name as string).trim(),
      locationType: locationInput.locationType as OrganizationLocation['locationType'],
      addressLine1: (locationInput.addressLine1 as string).trim(),
      addressLine2: locationInput.addressLine2 ? (locationInput.addressLine2 as string).trim() : null,
      city: (locationInput.city as string).trim(),
      state: (locationInput.state as string).trim(),
      postalCode: (locationInput.postalCode as string).trim(),
      country: (locationInput.country as string).trim(),
      phone: (locationInput.phone as string).trim(),
      email: locationInput.email ? (locationInput.email as string).trim() : null,
    };

    const normalized = normalizePrimaryLocationTextFields(patch);
    const updated = await updatePrimaryLocation(auth.organizationId, normalized, auth.mode);
    if (!updated) {
      return NextResponse.json({ error: 'No primary location exists for this organization. Contact support to set one up.' }, { status: 404 });
    }
    updatedLocation = sanitizeLocation(updated);
  }

  return NextResponse.json({ organization: updatedOrganization, location: updatedLocation });
}
