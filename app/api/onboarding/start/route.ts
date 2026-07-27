import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requirePlatformAdministrator } from '@/lib/auth/requireOnboardingAccess';
import { startOnboarding } from '@/services/organizationProvisioningService';
import { validateOrganizationProfile } from '@/domain/onboarding/validation';
import { parseJsonBody } from '@/lib/onboarding/routeHelpers';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Creates a
 * brand-new tenant — organization (`status: 'draft'` -> `'onboarding'`)
 * plus its first `OnboardingSession`. Only a platform administrator may
 * call this (see lib/auth/platformAdmin.ts) — the one action in this
 * phase that must happen before any organization-scoped membership can
 * exist at all.
 *
 * `idempotencyKey` is required and is the sole guard against a duplicate
 * tenant from a double-click/retry — see
 * services/organizationProvisioningService.ts's `startOnboarding`.
 */
export async function POST(request: Request) {
  const access = await requirePlatformAdministrator();
  if (!access.authorized) return access.response;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body;

  if (typeof b.idempotencyKey !== 'string' || b.idempotencyKey.trim().length === 0) {
    return NextResponse.json({ error: 'idempotencyKey is required.' }, { status: 400 });
  }

  const errors = validateOrganizationProfile(b);
  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const { organization, session, isNew } = await startOnboarding(
    {
      idempotencyKey: b.idempotencyKey,
      legalName: b.legalName as string,
      displayName: b.displayName as string,
      primaryEmail: b.primaryEmail as string,
      primaryPhone: b.primaryPhone as string,
      website: typeof b.website === 'string' ? b.website : null,
      timezone: b.timezone as string,
      defaultCurrency: (b.defaultCurrency as string).toLowerCase(),
      actorUserId: access.session.user.id,
      idFactory: () => crypto.randomUUID(),
    },
    getDataAdapterMode(),
  );

  return NextResponse.json({ organization, onboardingSession: session, isNew }, { status: isNew ? 201 : 200 });
}
