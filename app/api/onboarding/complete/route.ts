import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { parseJsonBody, resolveOnboardingSessionAccess } from '@/lib/onboarding/routeHelpers';
import { completeOnboarding } from '@/services/organizationProvisioningService';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 9 —
 * Review & Launch. "Only the server may mark onboarding completed" — this
 * is the one route that can ever do so, and only after
 * `validateLaunchReadiness` confirms every required item (see
 * `completeOnboarding`'s own comment); a request naming an incomplete
 * organization is rejected (422) with the specific checklist, never
 * silently activated.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body;

  const resolved = await resolveOnboardingSessionAccess(b.onboardingSessionId);
  if (!resolved.ok) return resolved.response;
  const { onboardingSession, session } = resolved.data;

  const dataAdapterMode = getDataAdapterMode();
  const result = await completeOnboarding(onboardingSession.id, session.user.id, () => crypto.randomUUID(), dataAdapterMode);

  if (!result.success) {
    return NextResponse.json({ error: 'Launch requirements are not yet met.', checklist: result.checklist }, { status: 422 });
  }

  return NextResponse.json({ organization: result.organization, onboardingSession: result.session });
}
