import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditCase } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import * as externalFormConfigService from '@/services/externalFormConfigService';
import * as caseFormLinkService from '@/services/caseFormLinkService';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';
import { preservePdfForSubmission } from '@/services/externalFormPdfService';
import { recordExternalFormSubmissionLinked } from '@/services/activityService';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). The
 * "Unmatched Forms → Link to Case" action. CRITICAL INVARIANT (see this
 * route's own structural test): never creates a case, never allocates a
 * case number — `caseId` here must always name an EXISTING case; nothing
 * in this handler imports or calls case-creation/`reserveNextCaseNumber`.
 * Gated by `case.update`, matching every other case-adjacent write.
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
  if (typeof b.organizationId !== 'string' || typeof b.caseId !== 'string') {
    return NextResponse.json({ error: 'organizationId and caseId are required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to link forms to this case.' }, { status: 403 });
  }

  const submission = await externalFormSubmissionService.getById(submissionId, dataAdapterMode);
  if (!submission || submission.organizationId !== organizationId) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  if (submission.status !== 'unmatched') {
    return NextResponse.json({ error: 'This submission is already linked.' }, { status: 409 });
  }

  // Resolved from the submission's own (provider, externalFormId) — never
  // from a client-supplied config id, which would let a caller point an
  // unmatched submission at the wrong form's configuration.
  const config = await externalFormConfigService.findByProviderFormId(submission.provider, submission.externalFormId, dataAdapterMode);
  if (!config || config.organizationId !== organizationId) {
    return NextResponse.json({ error: 'Form configuration not found.' }, { status: 404 });
  }

  const link = await caseFormLinkService.linkExistingSubmission(organizationId, b.caseId, config.provider, config.id, submission.id, dataAdapterMode);
  const updatedSubmission = await externalFormSubmissionService.markLinked(submission.id, link.id, dataAdapterMode);

  const activityCtx = { organizationId, actorIdentityId: userId, actorMembershipId: null, actorRoleKey: role, correlationId: crypto.randomUUID() };
  try {
    await recordExternalFormSubmissionLinked(activityCtx, b.caseId, submission.id, config.label, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record external_form.submission_linked activity event:', error instanceof Error ? error.message : error);
  }

  const pdfResult = await preservePdfForSubmission(updatedSubmission ?? submission, b.caseId, activityCtx, dataAdapterMode);

  return NextResponse.json({ link, submission: updatedSubmission, pdf: pdfResult });
}
