import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditCase } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';
import * as caseFormLinkService from '@/services/caseFormLinkService';
import { preservePdfForSubmission } from '@/services/externalFormPdfService';

/**
 * Manors Jotform integration — PDF repair (2026-09). The narrow gap
 * `app/api/external-form-submissions/[submissionId]/link/route.ts` and
 * `app/api/cases/[caseId]/forms/[formConfigId]/import-submission/route.ts`
 * leave open: both already call `preservePdfForSubmission` once, at
 * link/import time, but neither can be reused to retry it afterward — the
 * `link` route explicitly 409s once a submission is no longer
 * `'unmatched'`. This route exists for exactly that case: a submission
 * that is ALREADY linked to a case (normal receipt, historical import, or
 * manual link — this route doesn't care which) whose PDF preservation
 * failed or was never attempted, and needs a safe retry.
 *
 * Reuses `preservePdfForSubmission` directly — no second PDF-fetch/store
 * code path. That function is already idempotent (an already-`'stored'`
 * submission with a `documentId` returns `already_stored` immediately,
 * never re-uploading) — calling this route on an already-successful
 * submission is a safe no-op, and calling it on a `'failed'`/`'pending'`
 * one performs exactly the same fetch-and-store attempt the original
 * link/import call made.
 *
 * CRITICAL INVARIANT, matching every other file in this integration: this
 * route never creates a Case, never allocates a case number, never
 * touches `caseSequences`, and never requires the caller to supply
 * submission contents again — everything needed (provider, form id,
 * submission id, case id) is already on the existing, authoritative
 * `ExternalFormSubmission`/`CaseFormLink` records.
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
    return NextResponse.json({ error: 'Not authorized to retry this document.' }, { status: 403 });
  }

  const submission = await externalFormSubmissionService.getById(submissionId, dataAdapterMode);
  if (!submission || submission.organizationId !== organizationId) {
    return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  }
  if (!submission.caseFormLinkId) {
    return NextResponse.json({ error: 'This submission is not linked to a case — nothing to retry against.' }, { status: 409 });
  }

  const link = await caseFormLinkService.getById(submission.caseFormLinkId, dataAdapterMode);
  if (!link || link.organizationId !== organizationId) {
    return NextResponse.json({ error: 'Linked case record not found.' }, { status: 404 });
  }

  const activityCtx = {
    organizationId,
    actorIdentityId: userId,
    actorMembershipId: null,
    actorRoleKey: role,
    correlationId: crypto.randomUUID(),
  };

  const pdfResult = await preservePdfForSubmission(submission, link.caseId, activityCtx, dataAdapterMode);
  return NextResponse.json({ submissionId: submission.id, caseId: link.caseId, pdf: pdfResult });
}
