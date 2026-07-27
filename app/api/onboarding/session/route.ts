import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { getSession } from '@/lib/auth/session';
import { requireOnboardingSessionAccess } from '@/lib/auth/requireOnboardingAccess';
import {
  getOnboardingSessionById,
  findResumableSessionForUser,
  getOrganization,
  getOrganizationWorkflow,
  validateLaunchReadiness,
} from '@/services/organizationProvisioningService';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Reads one
 * onboarding session — either by an explicit `?sessionId=` (the normal
 * case; the `/onboarding` UI persists this in its own URL across steps)
 * or, with no param, the caller's own most recent non-completed session
 * (the "exit and resume" convenience, so a staff member who closed the
 * tab can get back in without having saved the id anywhere themselves).
 *
 * Always includes the current launch-readiness checklist — the "Review &
 * Launch" step's own data, computed fresh from real provisioning state
 * every time rather than a separate endpoint.
 */
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('sessionId');
  const dataAdapterMode = getDataAdapterMode();

  const onboardingSession = sessionId
    ? await getOnboardingSessionById(sessionId, dataAdapterMode)
    : await (async () => {
        const authSession = await getSession();
        if (!authSession) return null;
        return findResumableSessionForUser(authSession.user.id, dataAdapterMode);
      })();

  if (!onboardingSession) {
    return NextResponse.json({ onboardingSession: null, organization: null, checklist: [] }, { status: sessionId ? 404 : 200 });
  }

  const access = await requireOnboardingSessionAccess(onboardingSession);
  if (!access.authorized) return access.response;

  const organization = await getOrganization(onboardingSession.organizationId, dataAdapterMode);
  const workflowTemplate = await getOrganizationWorkflow(onboardingSession.organizationId, dataAdapterMode);
  const { checklist, ready } = await validateLaunchReadiness(onboardingSession.organizationId, onboardingSession, dataAdapterMode);

  return NextResponse.json({ onboardingSession, organization, workflowTemplate, checklist, ready });
}
