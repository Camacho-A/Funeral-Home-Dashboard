import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody, resolveOnboardingSessionAccess } from '@/lib/onboarding/routeHelpers';
import { createPaymentIntegrationPlaceholder, markStepCompleted, type PaymentSetupChoice } from '@/services/organizationProvisioningService';

const VALID_CHOICES: PaymentSetupChoice[] = ['clover', 'not_configured', 'configure_later'];

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 7 —
 * Payments. Never accepts a credential value — only reference *names*
 * ("Do not collect or store Clover secrets in onboarding forms. Store
 * only credential-reference names."); the integration this creates always
 * starts disabled and stays that way until server-side credentials and
 * merchant configuration are verified out-of-band (see
 * docs/adr/ADR-022-clover-hosted-checkout-integration.md's activation
 * steps, unchanged by this phase).
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

  if (typeof b.choice !== 'string' || !(VALID_CHOICES as string[]).includes(b.choice)) {
    return NextResponse.json({ error: `choice must be one of: ${VALID_CHOICES.join(', ')}.` }, { status: 400 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const { integration } = await createPaymentIntegrationPlaceholder(
    onboardingSession.organizationId,
    b.choice as PaymentSetupChoice,
    {
      merchantIdReference: typeof b.merchantIdReference === 'string' ? b.merchantIdReference : undefined,
      credentialReference: typeof b.credentialReference === 'string' ? b.credentialReference : undefined,
      webhookSecretReference: typeof b.webhookSecretReference === 'string' ? b.webhookSecretReference : undefined,
    },
    dataAdapterMode,
  );

  const updatedSession = await markStepCompleted(onboardingSession, 'payments', dataAdapterMode);
  return NextResponse.json({
    integration,
    readiness: integration?.isEnabled ? 'Clover ready' : 'Clover not configured',
    onboardingSession: updatedSession,
  });
}
