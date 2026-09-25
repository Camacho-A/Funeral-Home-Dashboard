import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { requireAuthorizedOrganization } from '@/lib/auth/requireAuthorizedOrganization';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { canEditCase } from '@/services/authorizationPolicyService';
import { getDataAdapterMode, type DataAdapterMode } from '@/lib/env';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { mapWixCaseItem, type WixCaseItem } from '@/lib/wixCaseMapper';
import { caseFixtures } from '@/services/__mocks__/fixtures';
import * as externalFormConfigService from '@/services/externalFormConfigService';
import * as caseFormLinkService from '@/services/caseFormLinkService';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';
import { preservePdfForSubmission } from '@/services/externalFormPdfService';
import { fetchSubmissionAnswers, JotformClientError } from '@/lib/jotform/jotformClient';
import { extractMappedFieldsForForm } from '@/domain/externalForms/arrangementNokDerivation';
import { recordExternalFormSubmissionLinked } from '@/services/activityService';
import { reconcileCaseWorkflow } from '@/services/workflowReconciliationService';
import type { Case } from '@/types/case';

/**
 * Manors Jotform integration — historical-submission ingestion (2026-09).
 * Brings a Jotform submission that was received BEFORE webhook activation
 * (and therefore never went through `app/api/webhooks/jotform/route.ts`,
 * so no `ExternalFormSubmission` row exists for it yet) into an EXISTING
 * Solis case, reusing the exact same downstream architecture a normal
 * webhook delivery uses from the point a submission is authenticated
 * onward: `extractMappedFields` → `externalFormSubmissionService.receive`
 * → `caseFormLinkService.linkExistingSubmission` →
 * `externalFormSubmissionService.markLinked` → `preservePdfForSubmission`.
 * The existing reconciliation UI (`GET/POST
 * /api/external-form-submissions/[submissionId]/review`) is unchanged and
 * used unmodified once this route creates the submission row.
 *
 * Token bypass, deliberately scoped to this path only: a historical
 * submission predates `CaseFormLink` token issuance, so it structurally
 * cannot carry a valid `solisLinkToken`. Trust here comes from a
 * different, equally strong source — an authenticated, `case.update`
 * (`canEditCase`) -gated staff member EXPLICITLY choosing both the exact
 * existing case (via the URL's own `caseId`) and the exact existing form
 * slot (via `formConfigId`) before ever supplying a submission id. This
 * route never consults or requires `CaseFormLink.linkTokenHash` — that
 * mechanism, and `app/api/webhooks/jotform/route.ts`'s own token-based
 * matching, are completely unmodified and unaffected by this file's
 * existence. Normal future webhook submissions still require the normal
 * token/auth mechanism; nothing here weakens it.
 *
 * CRITICAL INVARIANT, enforced structurally (see this route's own entry
 * in domain/externalForms/criticalInvariants.test.ts): this handler NEVER
 * creates a Case and NEVER allocates/touches a case number — `caseId`
 * here always names a pre-existing case (loaded and 404'd if absent,
 * exactly like `generate-link`'s own case lookup), and nothing here
 * imports `reserveNextCaseNumber` or any case-creation path.
 *
 * Idempotent by construction: `externalFormSubmissionService.receive`'s
 * own deterministic id (`organizationId + provider + externalSubmissionId`)
 * means a second POST for the same Jotform submission id — whether a
 * genuine retry, or a mistaken attempt to import it against a DIFFERENT
 * case — resolves to the same existing row. If that row is already past
 * `unmatched` (already linked in an earlier call), this route returns the
 * existing state as-is (`alreadyImported: true`) rather than re-linking
 * or duplicating anything — this also means a second case can never
 * accidentally steal an already-imported submission out from under the
 * first. `preservePdfForSubmission` carries its own independent
 * already-stored short-circuit, so a retry never re-uploads a PDF either.
 *
 * Data minimization: only `formId`/`submittedAt`/qid-keyed `answers` are
 * ever read from Jotform's Submission API response (`fetchSubmissionAnswers`
 * — see its own doc comment); the raw response body is never persisted,
 * logged, or returned to the caller. `mappedFields` is computed through
 * the exact same `extractMappedFields` the webhook uses, so SSN/signature/
 * excluded-field data is structurally never surfaced here either (nothing
 * new to map that the field map doesn't already define).
 */

async function loadCase(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<Case | null> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', { filter: { _id: caseId, organizationId }, paging: { limit: 1 } });
  return response.dataItems[0] ? mapWixCaseItem(response.dataItems[0].data) : null;
}

function sanitizedFetchErrorMessage(error: unknown): string {
  return error instanceof JotformClientError
    ? `Failed to retrieve the Jotform submission (${error.category}).`
    : 'Failed to retrieve the Jotform submission.';
}

/**
 * GET — safe-metadata-only preview, used by the import-confirmation UI
 * before committing. Never returns answers, PII, or the raw Jotform
 * response — only the configured form's label, the submission's own
 * submitted-at timestamp, and whether it actually belongs to the
 * expected form. Gated identically to POST (`canEditCase`), since this
 * preview exists solely in service of that write action.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string; formConfigId: string }> }) {
  const { caseId, formConfigId } = await params;
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId');
  const externalSubmissionId = url.searchParams.get('externalSubmissionId');
  if (!organizationId || !externalSubmissionId) {
    return NextResponse.json({ error: 'organizationId and externalSubmissionId are required.' }, { status: 400 });
  }

  const authResult = await requireAuthorizedOrganization(organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId: resolvedOrganizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canEditCase({ identityId: userId, organizationId: resolvedOrganizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to import forms for this case.' }, { status: 403 });
  }

  const config = await externalFormConfigService.getById(resolvedOrganizationId, formConfigId, dataAdapterMode);
  if (!config) {
    return NextResponse.json({ error: 'Form configuration not found.' }, { status: 404 });
  }
  const theCase = await loadCase(resolvedOrganizationId, caseId, dataAdapterMode);
  if (!theCase) {
    return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
  }

  let jotformSubmission;
  try {
    jotformSubmission = await fetchSubmissionAnswers(externalSubmissionId);
  } catch (error) {
    return NextResponse.json({ error: sanitizedFetchErrorMessage(error) }, { status: 502 });
  }

  return NextResponse.json({
    formLabel: config.label,
    submittedAt: jotformSubmission.submittedAt,
    matchesConfig: jotformSubmission.formId === config.externalFormId,
  });
}

/** POST — commits the import. See the module doc comment for the full flow. */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string; formConfigId: string }> }) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const { caseId, formConfigId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  if (typeof b.organizationId !== 'string' || typeof b.externalSubmissionId !== 'string' || !b.externalSubmissionId) {
    return NextResponse.json({ error: 'organizationId and externalSubmissionId are required.' }, { status: 400 });
  }
  const externalSubmissionId = b.externalSubmissionId;

  const authResult = await requireAuthorizedOrganization(b.organizationId);
  if (!authResult.authorized) return authResult.response;
  const { organizationId, userId, role } = authResult.context;
  const dataAdapterMode = getDataAdapterMode();

  if (!(await canEditCase({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode))) {
    return NextResponse.json({ error: 'Not authorized to import forms for this case.' }, { status: 403 });
  }

  const config = await externalFormConfigService.getById(organizationId, formConfigId, dataAdapterMode);
  if (!config) {
    return NextResponse.json({ error: 'Form configuration not found.' }, { status: 404 });
  }
  const theCase = await loadCase(organizationId, caseId, dataAdapterMode);
  if (!theCase) {
    return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
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

  const mappedFields = extractMappedFieldsForForm(config.provider, config.externalFormId, jotformSubmission.answers);

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

  if (submission.status !== 'unmatched') {
    // Already imported (a retry, or a mistaken second attempt against a
    // different case) — never re-linked, never duplicated.
    return NextResponse.json({ submission, alreadyImported: true });
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

  // Manors workflow reconciliation (2026-09): same reasoning as the
  // historical-import route — this case's Arrangement Form is now a
  // completed prerequisite.
  await reconcileCaseWorkflow(organizationId, caseId, dataAdapterMode);

  return NextResponse.json({ link, submission: updatedSubmission, pdf: pdfResult, alreadyImported: false });
}
