import { NextResponse } from 'next/server';
import type { AuthSession } from '../../types/auth';
import type { OnboardingSession } from '../../types/onboarding';
import { getDataAdapterMode } from '../env';
import { getOnboardingSessionById } from '../../services/organizationProvisioningService';
import { requireOnboardingSessionAccess } from '../auth/requireOnboardingAccess';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). The one
 * lookup+authorization sequence every onboarding Route Handler other than
 * `/start` performs: resolve the `OnboardingSession` from an opaque,
 * client-supplied `onboardingSessionId` — never an `organizationId`
 * directly — then check the caller is allowed to act on it. See
 * `lib/auth/requireOnboardingAccess.ts`'s own comment for why this shape
 * is necessary (no ordinary organization-scoped authorization check can
 * succeed before an administrator membership exists).
 */
export type ResolvedOnboardingRequest = { onboardingSession: OnboardingSession; session: AuthSession };

export async function resolveOnboardingSessionAccess(
  onboardingSessionId: unknown,
): Promise<{ ok: true; data: ResolvedOnboardingRequest } | { ok: false; response: NextResponse }> {
  if (typeof onboardingSessionId !== 'string' || onboardingSessionId.trim().length === 0) {
    return { ok: false, response: NextResponse.json({ error: 'onboardingSessionId is required.' }, { status: 400 }) };
  }

  const onboardingSession = await getOnboardingSessionById(onboardingSessionId, getDataAdapterMode());
  if (!onboardingSession) {
    return { ok: false, response: NextResponse.json({ error: 'Onboarding session not found.' }, { status: 404 }) };
  }

  const access = await requireOnboardingSessionAccess(onboardingSession);
  if (!access.authorized) return { ok: false, response: access.response };

  return { ok: true, data: { onboardingSession, session: access.session } };
}

export async function parseJsonBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) };
  }
  if (!body || typeof body !== 'object') {
    return { ok: false, response: NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }) };
  }
  return { ok: true, body: body as Record<string, unknown> };
}
