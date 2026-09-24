import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canCreateCase } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import * as externalFormConfigService from '@/services/externalFormConfigService';
import * as caseFormLinkService from '@/services/caseFormLinkService';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';
import { preservePdfForSubmission } from '@/services/externalFormPdfService';
import { fetchSubmissionAnswers, JotformClientError } from '@/lib/jotform/jotformClient';
import { extractMappedFields } from '@/domain/externalForms/extractMappedFields';
import { fieldMapForForm } from '@/domain/externalForms/fieldMapping';
import { externalFormSubmissionId, isCaseCreationClaimToken } from '@/types/externalFormSubmission';
import { recordExternalFormSubmissionLinked } from '@/services/activityService';

/**
 * Manors Jotform integration — historical CASE creation (2026-09).
 * Distinct from, and complementary to, `app/api/cases/[caseId]/forms/
 * [formConfigId]/import-submission/route.ts` (which links a historical
 * submission to an EXISTING case). This route exists for the opposite
 * situation: a real historical Jotform submission with NO corresponding
 * Solis case at all — the decedent was never entered into Solis.
 *
 * CRITICAL INVARIANT, enforced structurally (see
 * domain/externalForms/historicalCaseCreationInvariants.test.ts): this is
 * the ONLY Jotform-integration file permitted to result in a new Case, and
 * even this file may only do so by calling the normal, unmodified
 * `POST /api/cases` endpoint via an internal same-origin request — it
 * never imports `reserveNextCaseNumber`, never calls `insertWixDataItem`
 * on the `cases` collection, and never predicts/hardcodes a case number.
 * `POST /api/cases` remains the sole owner of case.create authorization,
 * StaffProfile resolution, required-field validation, workflow-template
 * resolution, ALL-CAPS normalization, case-number reservation, and Case
 * insertion — this route supplies it with exactly the same shape of body
 * a human filling out "+ New Case" would, nothing more.
 *
 * INFORMANT vs. NEXT OF KIN (2026-09 audit, authoritative): Arrangement
 * Forms' "10. INFORMANT (LEGAL NEXT OF KIN)" block (qids 122/224/225) is
 * NEVER treated as Next of Kin. It is surfaced in the preview purely as
 * read-only reference context; `nextOfKinName`/`nextOfKinPhone` are
 * always supplied by explicit staff entry, never derived from Informant
 * data, and never auto-applied.
 *
 * IDEMPOTENCY / CONCURRENCY: `ExternalFormSubmission`'s existing
 * deterministic id is the shared claim mechanism between this route and
 * the "link to existing case" importer — a submission already handled by
 * EITHER path is recognized and never double-processed by the other (see
 * the resolution order below). Case creation itself additionally uses a
 * compare-and-swap fence against `createdCaseId`
 * (`externalFormSubmissionService.claimForCaseCreation`) to prevent two
 * concurrent requests from both observing "no case yet" and independently
 * creating two cases — live-verified against the real Wix project (8
 * concurrent-claim rounds, exactly one winner every round); see that
 * function's own doc comment for the full account.
 */

type MappedPreview = {
  decedentName?: string;
  dateOfBirth?: string;
  dateOfDeath?: string;
  placeOfDeath?: string;
  informantName?: string;
  informantRelationship?: string;
  informantPhone?: string;
};

function sanitizedFetchErrorMessage(error: unknown): string {
  return error instanceof JotformClientError
    ? `Failed to retrieve the Jotform submission (${error.category}).`
    : 'Failed to retrieve the Jotform submission.';
}

function previewFromMappedFields(mapped: Partial<Record<string, string>>): MappedPreview {
  return {
    decedentName: mapped.decedentName,
    dateOfBirth: mapped.dateOfBirth,
    dateOfDeath: mapped.dateOfDeath,
    placeOfDeath: mapped.placeOfDeath,
    informantName: mapped.informantName,
    informantRelationship: mapped.informantRelationship,
    informantPhone: mapped.informantPhone,
  };
}

/**
 * GET — safe-preview-only, never mutates. Returns only the fields a staff
 * member needs to confirm "this is the right submission" and to see
 * Informant reference data — never SSN, signatures, raw answers, or any
 * other unmapped field.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  const formConfigId = url.searchParams.get('formConfigId');
  const externalSubmissionId = url.searchParams.get('externalSubmissionId');
  if (!organizationId || !formConfigId || !externalSubmissionId) {
    return NextResponse.json({ error: 'organizationId, formConfigId, and externalSubmissionId are required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canCreateCase({ identityId: userId, organizationId: resolvedOrganizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to create cases for this organization.' }, { status: 403 });
  }

  const config = await externalFormConfigService.getById(resolvedOrganizationId, formConfigId, dataAdapterMode);
  if (!config) {
    return NextResponse.json({ error: 'Form configuration not found.' }, { status: 404 });
  }

  let jotformSubmission;
  try {
    jotformSubmission = await fetchSubmissionAnswers(externalSubmissionId);
  } catch (error) {
    return NextResponse.json({ error: sanitizedFetchErrorMessage(error) }, { status: 502 });
  }

  const matchesConfig = jotformSubmission.formId === config.externalFormId;
  const mapped = matchesConfig ? extractMappedFields(fieldMapForForm(config.provider, config.externalFormId), jotformSubmission.answers) : {};

  // Read-only lookup — never inserts. Purely informational, so the UI can
  // warn "already imported" before the staff member fills anything in.
  const id = externalFormSubmissionId(resolvedOrganizationId, config.provider, externalSubmissionId);
  const existing = await externalFormSubmissionService.getById(id, dataAdapterMode);
  const alreadyAssociated = Boolean(existing && existing.status !== 'unmatched');
  const existingCaseId = existing && typeof existing.createdCaseId === 'string' && !isCaseCreationClaimToken(existing.createdCaseId) ? existing.createdCaseId : null;

  return NextResponse.json({
    formLabel: config.label,
    submittedAt: jotformSubmission.submittedAt,
    matchesConfig,
    alreadyAssociated,
    existingCaseId,
    ...previewFromMappedFields(mapped),
  });
}

/** POST — commits case creation. See the module doc comment for the full flow. */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (
    typeof b.organizationId !== 'string' ||
    typeof b.formConfigId !== 'string' ||
    typeof b.externalSubmissionId !== 'string' ||
    !b.externalSubmissionId
  ) {
    return NextResponse.json({ error: 'organizationId, formConfigId, and externalSubmissionId are required.' }, { status: 400 });
  }
  const nextOfKinName = typeof b.nextOfKinName === 'string' ? b.nextOfKinName.trim() : '';
  const nextOfKinPhone = typeof b.nextOfKinPhone === 'string' ? b.nextOfKinPhone.trim() : '';
  if (!nextOfKinName || !nextOfKinPhone) {
    return NextResponse.json({ error: 'Next of Kin name and phone are both required.' }, { status: 400 });
  }
  const externalSubmissionId = b.externalSubmissionId;
  const formConfigId = b.formConfigId;

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canCreateCase({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to create cases for this organization.' }, { status: 403 });
  }

  const config = await externalFormConfigService.getById(organizationId, formConfigId, dataAdapterMode);
  if (!config) {
    return NextResponse.json({ error: 'Form configuration not found.' }, { status: 404 });
  }

  let jotformSubmission;
  try {
    jotformSubmission = await fetchSubmissionAnswers(externalSubmissionId);
  } catch (error) {
    return NextResponse.json({ error: sanitizedFetchErrorMessage(error) }, { status: 502 });
  }

  if (jotformSubmission.formId !== config.externalFormId) {
    return NextResponse.json({ error: 'This Jotform submission does not belong to the selected form.' }, { status: 400 });
  }

  const fieldMap = fieldMapForForm(config.provider, config.externalFormId);
  const mappedFields = extractMappedFields(fieldMap, jotformSubmission.answers);

  // Claim the submission itself — shared with the "link to existing case"
  // importer via the same deterministic id.
  const { submission } = await externalFormSubmissionService.receive(
    {
      organizationId,
      provider: config.provider,
      externalFormId: config.externalFormId,
      externalSubmissionId,
      caseFormLinkId: null,
      mappedFields: JSON.stringify(mappedFields),
      pdfStatus: 'pending',
    },
    dataAdapterMode,
  );

  let caseId: string;
  let caseNumber: string | null = null;

  if (submission.status !== 'unmatched') {
    // Already handled — either by this route in a prior call, or by the
    // "link to existing case" importer. Never double-processed.
    return NextResponse.json({
      alreadyImported: true,
      caseId: typeof submission.createdCaseId === 'string' && !isCaseCreationClaimToken(submission.createdCaseId) ? submission.createdCaseId : null,
      submission,
    });
  }

  if (typeof submission.createdCaseId === 'string' && !isCaseCreationClaimToken(submission.createdCaseId)) {
    // Case was created in a prior attempt, but linking never completed —
    // resume there, never create a second case.
    caseId = submission.createdCaseId;
  } else if (typeof submission.createdCaseId === 'string' && isCaseCreationClaimToken(submission.createdCaseId)) {
    // Another request's claim is currently in flight.
    return NextResponse.json({ error: 'This submission is already being processed. Please try again shortly.' }, { status: 409 });
  } else {
    const claim = await externalFormSubmissionService.claimForCaseCreation(submission.id, dataAdapterMode);
    if (!claim.claimed) {
      if (claim.existingCaseId) {
        caseId = claim.existingCaseId;
      } else {
        return NextResponse.json({ error: 'This submission is already being processed. Please try again shortly.' }, { status: 409 });
      }
    } else {
      try {
        const origin = new URL(request.url).origin;
        const caseResponse = await fetch(`${origin}/api/cases`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: origin,
            Cookie: request.headers.get('cookie') ?? '',
          },
          body: JSON.stringify({
            organizationId,
            decedentName: mappedFields.decedentName,
            dateOfBirth: mappedFields.dateOfBirth,
            dateOfDeath: mappedFields.dateOfDeath,
            placeOfDeath: mappedFields.placeOfDeath,
            nextOfKinName,
            nextOfKinPhone,
          }),
        });
        if (!caseResponse.ok) {
          await externalFormSubmissionService.revertCaseCreationClaim(submission.id, claim.claimToken, dataAdapterMode);
          const errorBody = await caseResponse.json().catch(() => ({}));
          return NextResponse.json({ error: errorBody.error ?? 'Failed to create case.' }, { status: caseResponse.status });
        }
        const { case: newCase } = await caseResponse.json();
        await externalFormSubmissionService.markCaseCreated(submission.id, newCase.id, dataAdapterMode);
        caseId = newCase.id;
        caseNumber = newCase.caseNumber ?? null;
      } catch (error) {
        try {
          await externalFormSubmissionService.revertCaseCreationClaim(submission.id, claim.claimToken, dataAdapterMode);
        } catch (revertError) {
          console.error('Failed to revert case-creation claim after a failed attempt:', revertError instanceof Error ? revertError.message : revertError);
        }
        console.error('Historical case creation failed:', error instanceof Error ? error.message : error);
        return NextResponse.json({ error: 'Failed to create case.' }, { status: 503 });
      }
    }
  }

  const link = await caseFormLinkService.linkExistingSubmission(organizationId, caseId, config.provider, config.id, submission.id, dataAdapterMode);
  const updatedSubmission = await externalFormSubmissionService.markLinked(submission.id, link.id, dataAdapterMode);

  const activityCtx = {
    organizationId,
    actorIdentityId: userId,
    actorMembershipId: null,
    actorRoleKey: role,
    correlationId: crypto.randomUUID(),
  };
  try {
    await recordExternalFormSubmissionLinked(activityCtx, caseId, submission.id, config.label, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record external_form.submission_linked activity event:', error instanceof Error ? error.message : error);
  }

  const pdfResult = await preservePdfForSubmission(updatedSubmission ?? submission, caseId, activityCtx, dataAdapterMode);

  return NextResponse.json({ caseId, caseNumber, alreadyImported: false, link, submission: updatedSubmission, pdf: pdfResult });
}
