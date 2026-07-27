import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody, resolveOnboardingSessionAccess } from '@/lib/onboarding/routeHelpers';
import { updateOrganization, markStepCompleted } from '@/services/organizationProvisioningService';
import { validateOrganizationProfile } from '@/domain/onboarding/validation';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 1 —
 * Organization Profile. Never accepts `organizationId` — only
 * `onboardingSessionId`, resolved server-side (see
 * lib/onboarding/routeHelpers.ts's own comment).
 */
export async function PATCH(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body;

  const resolved = await resolveOnboardingSessionAccess(b.onboardingSessionId);
  if (!resolved.ok) return resolved.response;
  const { onboardingSession } = resolved.data;

  const errors = validateOrganizationProfile(b);
  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const organization = await updateOrganization(
    onboardingSession.organizationId,
    {
      legalName: b.legalName as string,
      name: b.displayName as string,
      primaryEmail: b.primaryEmail as string,
      primaryPhone: b.primaryPhone as string,
      website: typeof b.website === 'string' ? b.website : null,
      timezone: b.timezone as string,
      defaultCurrency: (b.defaultCurrency as string).toLowerCase(),
    },
    dataAdapterMode,
  );
  if (!organization) {
    return NextResponse.json({ error: 'Organization not found.' }, { status: 404 });
  }

  const updatedSession = await markStepCompleted(onboardingSession, 'organization_profile', dataAdapterMode);
  return NextResponse.json({ organization, onboardingSession: updatedSession });
}
