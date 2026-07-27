import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDataAdapterMode } from '@/lib/env';
import { parseJsonBody, resolveOnboardingSessionAccess } from '@/lib/onboarding/routeHelpers';
import { provisionWorkflow, markStepCompleted, type ProvisionWorkflowMode } from '@/services/organizationProvisioningService';

const VALID_MODES: ProvisionWorkflowMode[] = ['starter', 'clone_existing', 'minimal'];

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Step 4 —
 * Workflow Setup. Materializes a brand-new, organization-owned
 * WorkflowTemplate — never a reference to any other organization's
 * template (see provisionWorkflow's own comment). Idempotent: retrying
 * returns the org's already-provisioned workflow unchanged.
 */
export async function PATCH(request: Request) {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body;

  const resolved = await resolveOnboardingSessionAccess(b.onboardingSessionId);
  if (!resolved.ok) return resolved.response;
  const { onboardingSession } = resolved.data;

  if (typeof b.mode !== 'string' || !(VALID_MODES as string[]).includes(b.mode)) {
    return NextResponse.json({ error: `mode must be one of: ${VALID_MODES.join(', ')}.` }, { status: 400 });
  }
  if (b.mode === 'clone_existing' && (typeof b.sourceTemplateId !== 'string' || b.sourceTemplateId.trim().length === 0)) {
    return NextResponse.json({ error: 'sourceTemplateId is required when mode is clone_existing.' }, { status: 400 });
  }

  const dataAdapterMode = getDataAdapterMode();
  let template;
  try {
    ({ template } = await provisionWorkflow(
      onboardingSession.organizationId,
      {
        mode: b.mode as ProvisionWorkflowMode,
        sourceTemplateId: typeof b.sourceTemplateId === 'string' ? b.sourceTemplateId : undefined,
        name: typeof b.name === 'string' ? b.name : undefined,
      },
      () => crypto.randomUUID(),
      dataAdapterMode,
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to provision workflow.';
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const updatedSession = await markStepCompleted(onboardingSession, 'workflow_setup', dataAdapterMode);
  return NextResponse.json({ workflowTemplate: template, onboardingSession: updatedSession });
}
