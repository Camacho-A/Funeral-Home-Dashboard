import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody, resolveOnboardingSessionAccess } from '@/lib/onboarding/routeHelpers';
import { assignInitialAdministrator, markStepCompleted } from '@/services/organizationProvisioningService';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 3 —
 * Administrator Account. Not one of the phase spec's own explicitly
 * listed example routes ("Add routes such as: ...") but required by the
 * spec's own numbered step list — the routes list was illustrative, not
 * exhaustive, so this fills the one genuine gap between the two.
 *
 * Only ever assigns the literal `'administrator'` role, regardless of
 * what the request body contains — `assignInitialAdministrator` itself
 * has no parameter through which a caller could request any other role,
 * satisfying "Do not allow the client to assign arbitrary platform-level
 * permissions" structurally, not just by convention.
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

  if (typeof b.administratorUserId !== 'string' || b.administratorUserId.trim().length === 0) {
    return NextResponse.json({ errors: [{ field: 'administratorUserId', message: 'An administrator user id is required.' }] }, { status: 400 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const { membership } = await assignInitialAdministrator(
    onboardingSession.organizationId,
    b.administratorUserId,
    () => crypto.randomUUID(),
    dataAdapterMode,
  );

  const updatedSession = await markStepCompleted(onboardingSession, 'administrator_account', dataAdapterMode);
  return NextResponse.json({ membership, onboardingSession: updatedSession });
}
