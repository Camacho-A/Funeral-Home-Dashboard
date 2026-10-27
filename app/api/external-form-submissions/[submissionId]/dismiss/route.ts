import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditCase } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import * as externalFormConfigService from '@/services/externalFormConfigService';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';
import { recordExternalFormSubmissionDismissed } from '@/services/activityService';

/**
 * Unmatched Forms → No action needed (2026-10). Clears a submission staff
 * have checked and found needs nothing — typically one held as a likely
 * duplicate of a case SOLIS already has. It ONLY leaves the queue: nothing
 * is deleted, no case is created, linked or changed, and no PDF or
 * notification is touched. The submission row is kept (status
 * `dismissed`, with who and when) and the action is recorded in the
 * activity log. Gated by `case.update`, like linking.
 */
export async function POST(request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { submissionId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.organizationId !== 'string') {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to clear unmatched forms.' }, { status: 403 });
  }

  const submission = await externalFormSubmissionService.getById(submissionId, dataAdapterMode);
  if (!submission || submission.organizationId !== organizationId) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  // Only a submission still waiting in the queue can be cleared — never one
  // already linked, reviewed, or used to create a case.
  if (submission.status !== 'unmatched' || submission.caseFormLinkId || submission.createdCaseId) {
    return NextResponse.json({ error: 'This submission is no longer in Unmatched Forms.' }, { status: 409 });
  }

  const dismissed = await externalFormSubmissionService.markDismissed(submission.id, userId, dataAdapterMode);
  if (!dismissed) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }

  try {
    const config = await externalFormConfigService.findByProviderFormId(submission.provider, submission.externalFormId, dataAdapterMode);
    let decedentName: string | null = null;
    try {
      const mapped = JSON.parse(submission.mappedFields) as Record<string, unknown>;
      decedentName = typeof mapped.decedentName === 'string' && mapped.decedentName.trim() ? mapped.decedentName.trim() : null;
    } catch {
      decedentName = null;
    }
    await recordExternalFormSubmissionDismissed(
      { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() },
      submission.id,
      config?.label ?? 'Form',
      decedentName,
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record external_form.submission_dismissed activity event:', error instanceof Error ? error.message : error);
  }

  return NextResponse.json({ submission: dismissed });
}
