import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody, resolveOnboardingSessionAccess } from '@/lib/onboarding/routeHelpers';
import { saveBranding, markStepCompleted } from '@/services/organizationProvisioningService';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 8 —
 * Branding. `logoUrl` must already be a hosted URL — this route never
 * accepts binary/base64 image data ("Do not store binary logo data
 * directly in Wix rows"), matching `types/organizationBranding.ts`'s own
 * structural guarantee.
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

  const dataAdapterMode = getDataAdapterMode();
  const branding = await saveBranding(
    onboardingSession.organizationId,
    {
      logoUrl: typeof b.logoUrl === 'string' ? b.logoUrl : null,
      primaryColor: typeof b.primaryColor === 'string' ? b.primaryColor : null,
      secondaryColor: typeof b.secondaryColor === 'string' ? b.secondaryColor : null,
      accentColor: typeof b.accentColor === 'string' ? b.accentColor : null,
      emailFromName: typeof b.emailFromName === 'string' ? b.emailFromName : null,
      documentFooter: typeof b.documentFooter === 'string' ? b.documentFooter : null,
    },
    dataAdapterMode,
  );

  const updatedSession = await markStepCompleted(onboardingSession, 'branding', dataAdapterMode);
  return NextResponse.json({ branding, onboardingSession: updatedSession });
}
