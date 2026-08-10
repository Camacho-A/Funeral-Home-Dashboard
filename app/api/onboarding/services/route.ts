import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody, resolveOnboardingSessionAccess } from '@/lib/onboarding/routeHelpers';
import { seedServiceCatalog, markStepCompleted } from '@/services/organizationProvisioningService';
import { seedChartOfAccounts } from '@/services/chartOfAccountsService';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 6 —
 * Services & Pricing. Seeds a fresh, organization-owned service catalog —
 * never a reference to Manor's Cremation's (or any other organization's)
 * rows. Idempotent: retrying returns the org's already-seeded catalog.
 *
 * Phase 31 (Financial Management & General Ledger) additionally seeds this
 * organization's starter chart of accounts here, right alongside the
 * service catalog — both are per-org starter financial configuration a
 * brand-new tenant needs before it can record a case order or a payment,
 * so provisioning them in the same step keeps onboarding from needing a
 * dedicated accounting step of its own. Also idempotent.
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
  const { catalog } = await seedServiceCatalog(onboardingSession.organizationId, () => crypto.randomUUID(), dataAdapterMode);
  await seedChartOfAccounts(onboardingSession.organizationId, () => crypto.randomUUID(), dataAdapterMode);

  const updatedSession = await markStepCompleted(onboardingSession, 'services_pricing', dataAdapterMode);
  return NextResponse.json({ catalog, onboardingSession: updatedSession });
}
