import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody, resolveOnboardingSessionAccess } from '@/lib/onboarding/routeHelpers';
import {
  assignInitialAdministrator,
  inviteInitialAdministrator,
  markStepCompleted,
  getOrganization,
  OnboardingAdministratorError,
} from '@/services/organizationProvisioningService';
import { getIdentityMessageSender } from '@/lib/identity/messageSender';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 3 —
 * Administrator Account. Not one of the phase spec's own explicitly
 * listed example routes ("Add routes such as: ...") but required by the
 * spec's own numbered step list — the routes list was illustrative, not
 * exhaustive, so this fills the one genuine gap between the two.
 *
 * Only ever assigns the literal `'administrator'` role, regardless of
 * what the request body contains — neither service function has a
 * parameter through which a caller could request any other role,
 * satisfying "Do not allow the client to assign arbitrary platform-level
 * permissions" structurally, not just by convention.
 *
 * Safe onboarding (2026-10) — two ways to name the first administrator:
 * - `administratorUserId`: an existing identity id → an ACTIVE membership
 *   in the current identity format (identity login works immediately).
 *   An unknown identity is a 400 (`identity_not_found`).
 * - `administratorEmail` + `administratorDisplayName`: a person with no
 *   identity yet → the existing invitation flow (email verification +
 *   password; acceptance activates the membership). Launch stays blocked
 *   until they accept.
 */
export async function PATCH(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body;

  const resolved = await resolveOnboardingSessionAccess(b.onboardingSessionId);
  if (!resolved.ok) return resolved.response;
  const { onboardingSession, session } = resolved.data;
  const dataAdapterMode = getDataAdapterMode();
  const idFactory = () => crypto.randomUUID();

  const hasUserId = typeof b.administratorUserId === 'string' && b.administratorUserId.trim().length > 0;
  const hasEmail = typeof b.administratorEmail === 'string' && b.administratorEmail.trim().length > 0;

  if (!hasUserId && hasEmail) {
    if (typeof b.administratorDisplayName !== 'string' || b.administratorDisplayName.trim().length === 0) {
      return NextResponse.json(
        { errors: [{ field: 'administratorDisplayName', message: 'A display name is required when inviting by email.' }] },
        { status: 400 },
      );
    }
    const result = await inviteInitialAdministrator(
      onboardingSession.organizationId,
      { email: b.administratorEmail as string, displayName: b.administratorDisplayName, invitedByIdentityId: session.user.id },
      idFactory,
      dataAdapterMode,
    );
    if (result.outcome === 'disabled') {
      return NextResponse.json(
        { error: "This person's membership in the organization is disabled.", outcome: result.outcome },
        { status: 409 },
      );
    }
    if (result.outcome === 'invited' || result.outcome === 'reactivated') {
      try {
        const organization = await getOrganization(onboardingSession.organizationId, dataAdapterMode);
        await getIdentityMessageSender().send({
          kind: 'invitation',
          to: result.identity.email,
          token: result.verificationToken,
          organizationId: onboardingSession.organizationId,
          membershipId: result.membership.id,
          organizationName: organization?.name ?? 'your organization',
        });
      } catch (error) {
        console.error('Failed to send administrator invitation:', error instanceof Error ? error.message : error);
        return NextResponse.json(
          {
            error: 'The administrator invitation was created, but the email could not be sent. Resend it once email delivery is fixed.',
            membership: result.membership,
            outcome: result.outcome,
          },
          { status: 502 },
        );
      }
    }
    const updatedSession = await markStepCompleted(onboardingSession, 'administrator_account', dataAdapterMode);
    return NextResponse.json({ membership: result.membership, outcome: result.outcome, onboardingSession: updatedSession });
  }

  if (!hasUserId) {
    return NextResponse.json({ errors: [{ field: 'administratorUserId', message: 'An administrator user id is required.' }] }, { status: 400 });
  }

  let membership;
  try {
    ({ membership } = await assignInitialAdministrator(
      onboardingSession.organizationId,
      b.administratorUserId as string,
      idFactory,
      dataAdapterMode,
      { invitedByIdentityId: session.user.id },
    ));
  } catch (error) {
    if (error instanceof OnboardingAdministratorError) {
      return NextResponse.json(
        { errors: [{ field: 'administratorUserId', message: error.message }], code: error.code },
        { status: error.code === 'identity_not_found' ? 400 : 409 },
      );
    }
    throw error;
  }

  const updatedSession = await markStepCompleted(onboardingSession, 'administrator_account', dataAdapterMode);
  return NextResponse.json({ membership, onboardingSession: updatedSession });
}
