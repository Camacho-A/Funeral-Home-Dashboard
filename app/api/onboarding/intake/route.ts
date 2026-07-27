import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { parseJsonBody, resolveOnboardingSessionAccess } from '@/lib/onboarding/routeHelpers';
import { provisionIntakeConfiguration, markStepCompleted } from '@/services/organizationProvisioningService';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 5 —
 * Intake Setup. Reads back the intake configuration seeded from the
 * organization's own workflow (Step 4) for staff review — there is
 * nothing new to persist here beyond acknowledging the review, since
 * "Seed the intake configuration from the selected workflow" is already
 * satisfied by `provisionWorkflow` itself (intake lives inside a
 * `WorkflowTemplateVersion`, not a separate collection). Never exposes a
 * retired payment-card field type — `provisionIntakeConfiguration`
 * defensively filters them (see its own comment).
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
  const intake = await provisionIntakeConfiguration(onboardingSession.organizationId, dataAdapterMode);
  if (!intake) {
    return NextResponse.json({ error: 'No workflow has been provisioned yet — complete Workflow Setup first.' }, { status: 422 });
  }

  const updatedSession = await markStepCompleted(onboardingSession, 'intake_setup', dataAdapterMode);
  return NextResponse.json({ intake, onboardingSession: updatedSession });
}
