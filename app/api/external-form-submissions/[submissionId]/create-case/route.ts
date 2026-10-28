import { NextResponse } from 'next/server';
import { applyArrangementNokRelationship } from '@/services/externalForms/nokRelationshipAutofillService';
import { resolveFormRole } from '@/domain/externalForms/formRegistry';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canCreateCase } from '@/services/authorizationPolicyService';
import { getDataAdapterMode } from '@/lib/env';
import type { DataAdapterMode } from '@/lib/env';
import type { Case } from '@/types/case';
import type { ExternalFormConfig } from '@/types/externalFormConfig';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';
import type { MappedSolisField } from '@/domain/externalForms/fieldMapping';
import * as externalFormConfigService from '@/services/externalFormConfigService';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';
import { createCaseFromIntakeSubmission } from '@/services/externalFormIntakeService';
import { preservePdfForSubmission } from '@/services/externalFormPdfService';
import { authenticateJotformSubmission } from '@/lib/jotform/jotformSubmissionAuthenticity';
import { extractMappedFieldsForForm } from '@/domain/externalForms/arrangementNokDerivation';
import { findDuplicateCandidates, type DuplicateCandidate } from '@/domain/externalForms/duplicateCandidates';
import { isCaseCreationClaimToken } from '@/types/externalFormSubmission';
import { captureCaseSsnFromSubmission } from '@/services/caseSsnService';

/**
 * Unmatched Forms → "Create Case" (2026-10).
 *
 * Historical submissions that failed before the Arrangement-first fix
 * (eee95b2) are still sitting in Unmatched Forms, and the only way to
 * rescue one was to create a case by hand, come back, link it, then
 * review its fields. This turns that into one reviewed action.
 *
 * It is the SAME creation path the webhook uses —
 * `createCaseFromIntakeSubmission` — so case numbering, the
 * compare-and-swap claim, the CaseFormLink, provenance and workflow
 * reconciliation all behave identically whether a case was opened by an
 * automatic delivery or by a staff member here. Nothing about case
 * creation is reimplemented.
 *
 * NOTHING IS TRUSTED FROM THE CLIENT except the submission id in the path
 * and the organization id (which `requireAuthorizedOrganization` then
 * proves the caller actually belongs to). The form config is resolved
 * from the submission's own provider/formId, never from a supplied id;
 * the field values are re-fetched and re-verified from Jotform rather
 * than read from the cached `mappedFields`; and no case id is accepted at
 * all, because this route only ever creates.
 */

type Eligibility =
  | { ok: true; submission: ExternalFormSubmission; config: ExternalFormConfig }
  | { ok: false; response: NextResponse };

/**
 * Every check that must hold before this submission may open a case,
 * applied identically to the preview (GET) and the creation (POST) so the
 * dialog can never offer an action the write would refuse.
 */
async function resolveEligibility(
  submissionId: string,
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<Eligibility> {
  const submission = await externalFormSubmissionService.getById(submissionId, dataAdapterMode);
  // Organization ownership is checked here, not filtered later: a
  // submission belonging to another tenant is simply not found.
  if (!submission || submission.organizationId !== organizationId) {
    return { ok: false, response: NextResponse.json({ error: 'Submission not found.' }, { status: 404 }) };
  }

  // Already attached to a case — linking and creating are mutually
  // exclusive, and a second case must never be opened for one submission.
  if (submission.caseFormLinkId) {
    return { ok: false, response: NextResponse.json({ error: 'This submission is already linked to a case.' }, { status: 409 }) };
  }
  if (submission.createdCaseId && !isCaseCreationClaimToken(submission.createdCaseId)) {
    return { ok: false, response: NextResponse.json({ error: 'This submission has already created a case.' }, { status: 409 }) };
  }
  if (submission.createdCaseId && isCaseCreationClaimToken(submission.createdCaseId)) {
    // A creation attempt is in flight (the claim fence). A second click
    // must not race it.
    return { ok: false, response: NextResponse.json({ error: 'A case is already being created from this submission.' }, { status: 409 }) };
  }
  if (submission.status !== 'unmatched') {
    return { ok: false, response: NextResponse.json({ error: 'Only an unmatched submission can create a case.' }, { status: 409 }) };
  }

  const config = await externalFormConfigService.findByProviderFormId(
    submission.provider,
    submission.externalFormId,
    dataAdapterMode,
  );
  if (!config || config.organizationId !== organizationId) {
    return { ok: false, response: NextResponse.json({ error: 'Form configuration not found.' }, { status: 404 }) };
  }
  // The same per-form permission the webhook honours: allocating a case
  // number is an explicit configuration decision, never implied by a form
  // happening to carry a decedent name.
  if (config.purpose !== 'case_create') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${config.label} is not configured to create cases.` },
        { status: 403 },
      ),
    };
  }

  return { ok: true, submission, config };
}

/**
 * Re-fetches the submission's answers from Jotform and re-derives the
 * mapped fields, rather than trusting the `mappedFields` cached on the
 * row. For a historical submission that cache was computed by older code,
 * and re-deriving means a case opened today gets today's authoritative
 * mapping — including the Arrangement NOK derivation.
 */
async function loadVerifiedFields(
  config: ExternalFormConfig,
  submission: ExternalFormSubmission,
): Promise<{ ok: true; fields: Partial<Record<MappedSolisField, string>> } | { ok: false; response: NextResponse }> {
  const authenticated = await authenticateJotformSubmission({
    claimedFormId: config.externalFormId,
    claimedSubmissionId: submission.externalSubmissionId,
    // A historical submission is legitimately old, so the replay window
    // that guards unattended webhook deliveries must not apply: this
    // action is already authenticated, authorized and human-initiated.
    // Re-fetching by id still proves the submission genuinely exists on
    // this form, which is the provenance check that matters here.
    skipAgeCheck: true,
    ...(config.apiKeyReference ? { apiKeyReference: config.apiKeyReference } : {}),
  });
  if (!authenticated.authentic) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Could not verify this submission with Jotform (${authenticated.reason}).` },
        { status: authenticated.status },
      ),
    };
  }
  return { ok: true, fields: extractMappedFieldsForForm(config, authenticated.answers) };
}

async function organizationCases(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<Case[]> {
  if (dataAdapterMode === 'mock') {
    const { caseFixtures } = await import('@/services/__mocks__/fixtures');
    return caseFixtures.filter((c) => c.organizationId === organizationId);
  }
  const { queryAllWixDataItems } = await import('@/lib/wixDataApi');
  const { mapWixCaseItem } = await import('@/lib/wixCaseMapper');
  const items = await queryAllWixDataItems<Record<string, unknown>>('cases', { organizationId });
  return items.map((item) => mapWixCaseItem(item.data as never)).filter((c): c is Case => c !== null);
}

/** Everything the confirmation dialog shows — assembled server-side so
    the client never has to derive it, and so what staff are shown is
    exactly what the write will act on. */
export async function GET(request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  const organizationIdParam = new URL(request.url).searchParams.get('organizationId');
  if (!organizationIdParam) {
    return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationIdParam);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canCreateCase({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to create cases for this organization.' }, { status: 403 });
  }

  const eligibility = await resolveEligibility(submissionId, organizationId, dataAdapterMode);
  if (!eligibility.ok) return eligibility.response;
  const { submission, config } = eligibility;

  const verified = await loadVerifiedFields(config, submission);
  if (!verified.ok) return verified.response;

  const duplicateCandidates: DuplicateCandidate[] = findDuplicateCandidates(
    verified.fields,
    await organizationCases(organizationId, dataAdapterMode),
  );

  return NextResponse.json({
    formLabel: config.label,
    receivedAt: submission.receivedAt,
    decedentName: verified.fields.decedentName ?? null,
    dateOfDeath: verified.fields.dateOfDeath ?? null,
    dateOfBirth: verified.fields.dateOfBirth ?? null,
    nextOfKinName: verified.fields.nextOfKinName ?? null,
    duplicateCandidates,
  });
}

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

  if (!(await canCreateCase({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to create cases for this organization.' }, { status: 403 });
  }

  // Re-checked here, not merely on the preview: the state can have moved
  // between opening the dialog and confirming it (a webhook redelivery, a
  // colleague linking it, a second click).
  const eligibility = await resolveEligibility(submissionId, organizationId, dataAdapterMode);
  if (!eligibility.ok) return eligibility.response;
  const { submission, config } = eligibility;

  const verified = await loadVerifiedFields(config, submission);
  if (!verified.ok) return verified.response;

  // Duplicates are re-evaluated server-side too. `acknowledgedDuplicates`
  // only suppresses the block when staff were actually shown candidates
  // and chose to proceed — it can never conjure authorization, because
  // every other check above still had to pass.
  const acknowledgedDuplicates = b.acknowledgedDuplicates === true;

  const activityCtx = {
    organizationId,
    actorIdentityId: userId,
    actorMembershipId: null,
    actorRoleKey: role,
    correlationId: crypto.randomUUID(),
    isSystemGenerated: false,
  };

  const outcome = await createCaseFromIntakeSubmission(
    { config, submission, mappedFields: verified.fields, request, acknowledgedDuplicates },
    activityCtx,
    dataAdapterMode,
  );

  if (!outcome.created) {
    if (outcome.reason === 'duplicate_review_required') {
      return NextResponse.json(
        {
          error: 'This submission resembles an existing case. Review the candidates before creating a new case.',
          duplicateCandidates: outcome.duplicateCandidates ?? [],
        },
        { status: 409 },
      );
    }
    if (outcome.reason === 'already_claimed') {
      return NextResponse.json({ error: 'A case is already being created from this submission.' }, { status: 409 });
    }
    if (outcome.reason.startsWith('missing_required_fields')) {
      return NextResponse.json(
        { error: 'This submission does not carry enough information to open a case.' },
        { status: 422 },
      );
    }
    // Everything else is a server-side failure; the reason is logged by
    // the service and deliberately not echoed to the client.
    return NextResponse.json({ error: 'Could not create a case from this submission.' }, { status: 500 });
  }

  // Import the submission's PDF onto the new case (2026-10), exactly as the
  // webhook's own creation path does. Without this a staff-created case had
  // no copy of its form until someone pressed "Retry PDF". Reloaded so the
  // back-reference written during creation is present; idempotent, and a
  // PDF failure is recorded on the submission rather than failing creation.
  try {
    const refreshed = await externalFormSubmissionService.getById(submission.id, dataAdapterMode);
    await preservePdfForSubmission(refreshed ?? submission, outcome.caseId, activityCtx, dataAdapterMode, { config });
    // Next of Kin relationship (2026-10) — see nokRelationshipAutofillService.ts.
    if (resolveFormRole(config) === 'arrangement') await applyArrangementNokRelationship(activityCtx, outcome.caseId, refreshed ?? submission, dataAdapterMode);
    // Case SSN (2026-10): the Arrangement / Vital Statistics form's SSN, locked on the case.
    await captureCaseSsnFromSubmission(activityCtx, outcome.caseId, refreshed ?? submission, dataAdapterMode);
  } catch (error) {
    console.error('[create-case] Case created but its form PDF could not be imported:', error instanceof Error ? error.message : error);
  }

  return NextResponse.json({ case: { id: outcome.caseId, caseNumber: outcome.caseNumber } }, { status: 201 });
}
