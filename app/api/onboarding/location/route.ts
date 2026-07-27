import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody, resolveOnboardingSessionAccess } from '@/lib/onboarding/routeHelpers';
import { createPrimaryLocation, markStepCompleted } from '@/services/organizationProvisioningService';
import { validatePrimaryLocation } from '@/domain/onboarding/validation';

/** Phase 20 (Organization Onboarding & Tenant Provisioning). Step 2 —
    Primary Location. Idempotent: retrying returns the org's existing
    primary location unchanged (see createPrimaryLocation's own comment). */
export async function PATCH(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body;

  const resolved = await resolveOnboardingSessionAccess(b.onboardingSessionId);
  if (!resolved.ok) return resolved.response;
  const { onboardingSession } = resolved.data;

  const errors = validatePrimaryLocation(b);
  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const { location } = await createPrimaryLocation(
    onboardingSession.organizationId,
    {
      name: b.name as string,
      locationType: typeof b.locationType === 'string' ? b.locationType : undefined,
      addressLine1: b.addressLine1 as string,
      addressLine2: typeof b.addressLine2 === 'string' ? b.addressLine2 : null,
      city: b.city as string,
      state: b.state as string,
      postalCode: b.postalCode as string,
      country: b.country as string,
      phone: b.phone as string,
      email: typeof b.email === 'string' ? b.email : null,
    },
    () => crypto.randomUUID(),
    dataAdapterMode,
  );

  const updatedSession = await markStepCompleted(onboardingSession, 'primary_location', dataAdapterMode);
  return NextResponse.json({ location, onboardingSession: updatedSession });
}
