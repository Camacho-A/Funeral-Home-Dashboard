import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requirePlatformAdministrator } from '@/lib/auth/requireOnboardingAccess';
import { startOnboarding, OnboardingStartError } from '@/services/organizationProvisioningService';
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
 *
 * Safe onboarding (2026-10): optional `organizationId` (e.g.
 * `gus-camacho-jr`) — validated format, not reserved, allowed by this
 * deployment's DEPLOYMENT_ORGANIZATION_IDS, and not already existing
 * (409, never merged into an existing tenant). Omitted: a UUID on an
 * unrestricted deployment, or the deployment's single allowed organization
 * on a restricted one. Same idempotencyKey + same id resumes the draft; a
 * key reused for a different id is 409.
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

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

  if (b.organizationId !== undefined && b.organizationId !== null && typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId must be a string.', code: 'invalid_organization_id' }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof startOnboarding>>;
  try {
    result = await startOnboarding(
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
        organizationId: b.organizationId,
      },
      getDataAdapterMode(),
    );
  } catch (error) {
    if (error instanceof OnboardingStartError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
  const { organization, session, isNew } = result;

  return NextResponse.json({ organization, onboardingSession: session, isNew }, { status: isNew ? 201 : 200 });
}
