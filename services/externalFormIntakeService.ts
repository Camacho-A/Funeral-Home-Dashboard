import type { DataAdapterMode } from '../lib/env';
import type { Case } from '../types/case';
import type { ExternalFormConfig } from '../types/externalFormConfig';
import type { ExternalFormSubmission } from '../types/externalFormSubmission';
import type { MappedSolisField } from '../domain/externalForms/fieldMapping';
import { isCaseCreationClaimToken } from '../types/externalFormSubmission';
import { createExternalFormIntakeAuthorization } from '../lib/auth/externalFormIntakeAuthorization';
import * as externalFormSubmissionService from './externalFormSubmissionService';
import * as caseFormLinkService from './caseFormLinkService';
import { findDuplicateCandidates, type DuplicateCandidate } from '../domain/externalForms/duplicateCandidates';
import * as staffProfileService from './staffProfileService';
import { reconcileCaseWorkflow } from './workflowReconciliationService';
import {
  recordExternalFormSubmissionLinked,
  recordExternalFormSubmissionDuplicateSuspected,
  type ActivityContext,
} from './activityService';

/**
 * Automated form intake (2026-10). Turns a verified Jotform submission
 * from ANY `purpose: 'case_create'` form into exactly one Solis case.
 *
 * Form-agnostic by design (2026-10 follow-up): Manors staff take calls
 * overnight and often submit the Cremation Arrangement Forms before the
 * First Call Sheet is ever entered, so either form must be able to open a
 * case. Nothing in here is specific to the First Call Sheet — the form's
 * own `config` supplies its label (used for provenance) and its field map
 * supplies the values, so enabling a second creating form is a
 * configuration change, not a code change.
 *
 * CRITICAL INVARIANT — this module creates a case ONLY by calling the
 * normal, unmodified `POST /api/cases` over an internal same-origin
 * request. It never imports `reserveNextCaseNumber`, never writes the
 * `cases` collection, and never predicts or hardcodes a case number, so
 * case-number allocation keeps its single implementation and all of its
 * uniqueness and audit guarantees. This mirrors
 * `app/api/cases/historical-jotform-import/route.ts` exactly; the only
 * difference is how the request proves it is entitled to create — that
 * route forwards a staff member's session cookie, this one presents a
 * signed, single-purpose intake authorization, because a webhook has no
 * session (see lib/auth/externalFormIntakeAuthorization.ts).
 *
 * Unlike the historical path, NO case number is supplied: a first call is
 * a genuinely new case, so it takes the next number from the normal
 * sequence. `historicalCaseNumberAuthorization` is deliberately not used
 * here — preserving a pre-existing number is a different operation.
 */

export type FormIntakeOutcome =
  | { created: true; caseId: string; caseNumber: string }
  | { created: false; reason: string; duplicateCandidates?: DuplicateCandidate[] };

/** Mapped values a case genuinely cannot be created without. */
const REQUIRED_FOR_CREATION: MappedSolisField[] = ['decedentName', 'nextOfKinName', 'nextOfKinPhone'];

/**
 * Which staff profile a webhook-created case is attributed to.
 *
 * A webhook has no human actor, but `createdBy`/`intakeOwnerId` are
 * required and `intakeOwnerId` is immutable once set, so one must be
 * chosen deterministically rather than left blank. The organization's
 * earliest-created active profile is used: deterministic, always a real
 * member of that organization, and never a cross-tenant id. The case's
 * `assignedStaffId` remains freely reassignable afterward, which is the
 * field staff actually manage day to day.
 */
async function resolveIntakeStaffProfileId(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<string | null> {
  const profiles = await staffProfileService.list(organizationId, dataAdapterMode);
  const active = profiles
    .filter((profile) => profile.isActive)
    .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)));
  return active[0]?.id ?? null;
}

/**
 * Existing cases in THIS organization that resemble the submission.
 *
 * Reads are deliberately scoped by `organizationId` in the query itself,
 * never filtered after the fact, so a candidate from another tenant can
 * never reach `findDuplicateCandidates` — which does no tenant filtering
 * of its own by contract.
 *
 * Archived cases are included on purpose: a death already filed away is
 * still the same death, and creating a second case for it would be
 * exactly the duplicate this guard exists to prevent.
 */
async function findDuplicateCandidatesForOrganization(
  organizationId: string,
  mappedFields: Partial<Record<MappedSolisField, string>>,
  dataAdapterMode: DataAdapterMode,
): Promise<DuplicateCandidate[]> {
  try {
    if (dataAdapterMode === 'mock') {
      const { caseFixtures } = await import('./__mocks__/fixtures');
      return findDuplicateCandidates(
        mappedFields,
        caseFixtures.filter((c) => c.organizationId === organizationId),
      );
    }
    const { queryAllWixDataItems } = await import('../lib/wixDataApi');
    const { mapWixCaseItem } = await import('../lib/wixCaseMapper');
    const items = await queryAllWixDataItems<Record<string, unknown>>('cases', { organizationId });
    const cases = items
      .map((item) => mapWixCaseItem(item.data as never))
      .filter((c): c is Case => c !== null);
    return findDuplicateCandidates(mappedFields, cases);
  } catch (error) {
    // A lookup failure must not silently disable the guard and let a
    // duplicate through. Treat it as "cannot establish safety" and
    // surface a synthetic candidate so the submission is reviewed by a
    // human rather than auto-created on incomplete information.
    console.error(
      '[form intake] Duplicate-candidate lookup failed — refusing to auto-create, routing to review:',
      error instanceof Error ? error.message : error,
    );
    return [{ caseId: '', caseNumber: '(lookup unavailable)', decedentName: mappedFields.decedentName ?? '', matchedOn: [] }];
  }
}

export async function createCaseFromIntakeSubmission(
  params: {
    config: ExternalFormConfig;
    submission: ExternalFormSubmission;
    mappedFields: Partial<Record<MappedSolisField, string>>;
    request: Request;
    /**
     * Staff-initiated creation only (Unmatched Forms → Create Case).
     * When a human has been shown the duplicate candidates and chosen to
     * proceed anyway, the guard steps aside — it exists to stop SILENT
     * automatic duplication, not to overrule someone who has looked at
     * the candidates and decided this really is a different death.
     *
     * The webhook never sets this: an unattended delivery has nobody to
     * do the looking.
     */
    acknowledgedDuplicates?: boolean;
  },
  activityCtx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<FormIntakeOutcome> {
  const { config, submission, mappedFields, request, acknowledgedDuplicates = false } = params;

  const missing = REQUIRED_FOR_CREATION.filter((field) => !mappedFields[field]?.trim());
  if (missing.length > 0) {
    // Fail safely: the submission stays `unmatched` and appears in
    // Unmatched Forms, where staff can attach it to a case by hand. A
    // case is never created from partial data, and nothing is guessed.
    console.error(
      `[form intake] Submission ${submission.id} is missing required field(s) (${missing.join(', ')}) — left unmatched, no case created.`,
    );
    return { created: false, reason: `missing_required_fields:${missing.join(',')}` };
  }

  /**
   * Duplicate guard (2026-10). Two forms can now create a case, so the
   * same death can arrive twice with nothing linking the deliveries. If
   * an existing case already looks like this submission, SOLIS does NOT
   * create a second one and does NOT merge them — the submission stays
   * `unmatched` and appears in Unmatched Forms, where staff link it to
   * the right case deliberately. See
   * domain/externalForms/duplicateCandidates.ts for why a name alone is
   * never enough to flag one.
   */
  const candidates = acknowledgedDuplicates
    ? []
    : await findDuplicateCandidatesForOrganization(config.organizationId, mappedFields, dataAdapterMode);
  if (candidates.length > 0) {
    console.error(
      `[form intake] Submission ${submission.id} resembles existing case(s) ${candidates
        .map((c) => c.caseNumber)
        .join(', ')} — left unmatched for staff review, no case created and nothing merged.`,
    );
    try {
      await recordExternalFormSubmissionDuplicateSuspected(
        activityCtx,
        submission.id,
        config.label,
        candidates,
        dataAdapterMode,
      );
    } catch (error) {
      console.error(
        'Failed to record external_form.duplicate_suspected activity event:',
        error instanceof Error ? error.message : error,
      );
    }
    return { created: false, reason: 'duplicate_review_required', duplicateCandidates: candidates };
  }

  // Compare-and-swap claim — the same fence the historical-import path
  // uses. Two concurrent deliveries of one submission cannot both create
  // a case; the loser sees the claim and returns without creating.
  const claim = await externalFormSubmissionService.claimForCaseCreation(submission.id, dataAdapterMode);
  if (!claim.claimed) {
    return { created: false, reason: 'already_claimed' };
  }

  try {
    const intakeStaffProfileId = await resolveIntakeStaffProfileId(config.organizationId, dataAdapterMode);
    if (!intakeStaffProfileId) {
      await externalFormSubmissionService.revertCaseCreationClaim(submission.id, claim.claimToken, dataAdapterMode);
      console.error(
        `[form intake] Organization ${config.organizationId} has no active staff profile to attribute an intake case to — left unmatched.`,
      );
      return { created: false, reason: 'no_active_staff_profile' };
    }

    const externalFormIntakeAuthorization = await createExternalFormIntakeAuthorization({
      organizationId: config.organizationId,
      externalFormId: config.externalFormId,
      externalSubmissionId: submission.externalSubmissionId,
      intakeStaffProfileId,
    });

    const origin = new URL(request.url).origin;
    const caseResponse = await fetch(`${origin}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        organizationId: config.organizationId,
        decedentName: mappedFields.decedentName,
        nextOfKinName: mappedFields.nextOfKinName,
        nextOfKinPhone: mappedFields.nextOfKinPhone,
        // Optional mapped values — omitted entirely when the submission
        // did not carry them, never sent as empty strings, so the route's
        // own defaults apply instead of blanking a field.
        // Middle name (2026-10): omitted when the form left it blank, so
        // an empty box never blanks a value another form supplied.
        ...(mappedFields.decedentMiddleName ? { decedentMiddleName: mappedFields.decedentMiddleName } : {}),
        ...(mappedFields.dateOfBirth ? { dateOfBirth: mappedFields.dateOfBirth } : {}),
        ...(mappedFields.dateOfDeath ? { dateOfDeath: mappedFields.dateOfDeath } : {}),
        ...(mappedFields.timeOfDeath ? { timeOfDeath: mappedFields.timeOfDeath } : {}),
        ...(mappedFields.placeOfDeath ? { placeOfDeath: mappedFields.placeOfDeath } : {}),
        ...(mappedFields.weight ? { weight: mappedFields.weight } : {}),
        ...(mappedFields.nextOfKinEmail ? { nextOfKinEmail: mappedFields.nextOfKinEmail } : {}),
        // Certifier block (2026-10). Same omit-when-absent rule as every
        // optional field above — never sent as an empty string, so the
        // route's own defaults apply instead of blanking a field.
        ...(mappedFields.certifierName ? { certifierName: mappedFields.certifierName } : {}),
        ...(mappedFields.certifierPhone ? { certifierPhone: mappedFields.certifierPhone } : {}),
        ...(mappedFields.certifierLicenseNumber ? { certifierLicenseNumber: mappedFields.certifierLicenseNumber } : {}),
        ...(mappedFields.certifierFax ? { certifierFax: mappedFields.certifierFax } : {}),
        externalFormIntakeAuthorization,
      }),
    });

    if (!caseResponse.ok) {
      await externalFormSubmissionService.revertCaseCreationClaim(submission.id, claim.claimToken, dataAdapterMode);
      const body = await caseResponse.json().catch(() => null);
      console.error(
        `[form intake] POST /api/cases failed for submission ${submission.id} (HTTP ${caseResponse.status}): ${body?.error ?? 'unknown error'}`,
      );
      return { created: false, reason: `case_creation_failed:${caseResponse.status}` };
    }

    const created = (await caseResponse.json()).case as { id: string; caseNumber: string };
    await externalFormSubmissionService.markCaseCreated(submission.id, created.id, dataAdapterMode);

    /**
     * Give the new case the same CaseFormLink a token-matched submission
     * would have. Without it the case has no record that this form was
     * ever received: `workflowReconciliationService`'s
     * `isArrangementFormLinked` reads CaseFormLinks, so an
     * Arrangement-created case would otherwise show its own
     * Jotform-application checklist item as outstanding, and later
     * case-specific form links would have nothing to hang off.
     *
     * Uses the identical `linkExistingSubmission` call the manual
     * Unmatched-Forms link path uses, so a webhook-created association
     * and a staff-created one are the same shape. Best-effort: a failure
     * here must not unwind a case that genuinely exists — the submission
     * still carries `caseId`, and staff can link it by hand.
     */
    try {
      const link = await caseFormLinkService.linkExistingSubmission(
        config.organizationId,
        created.id,
        config.provider,
        config.id,
        submission.id,
        dataAdapterMode,
      );
      // Write the back-reference too (2026-10). The link pointed at the
      // submission but the submission did not point back, leaving the
      // association half-formed: `caseFormLinkId` stayed null while
      // `status` became 'matched'. Nothing could recover that state — the
      // retry-PDF route needs `caseFormLinkId`, and the manual link route
      // refuses anything already 'matched'. B2026-038 sat there.
      if (link?.id) {
        await externalFormSubmissionService.markLinked(submission.id, link.id, dataAdapterMode);
      }
    } catch (error) {
      console.error(
        `[form intake] Case ${created.caseNumber} was created but its CaseFormLink could not be written:`,
        error instanceof Error ? error.message : error,
      );
    }

    // Recorded against the new case so the submission that produced it is
    // visible in that case's own activity timeline. Best-effort: an audit
    // failure never unwinds a case that genuinely exists.
    try {
      await recordExternalFormSubmissionLinked(activityCtx, created.id, submission.id, config.label, dataAdapterMode);
    } catch (error) {
      console.error(
        'Failed to record external_form.submission_linked activity event:',
        error instanceof Error ? error.message : error,
      );
    }

    // Same reconciliation call every other submission path makes, so a
    // webhook-created case can never end up in a different workflow state
    // than one created any other way.
    await reconcileCaseWorkflow(config.organizationId, created.id, dataAdapterMode);

    return { created: true, caseId: created.id, caseNumber: created.caseNumber };
  } catch (error) {
    await externalFormSubmissionService.revertCaseCreationClaim(submission.id, claim.claimToken, dataAdapterMode);
    console.error(
      `[form intake] Unexpected failure creating a case for submission ${submission.id}:`,
      error instanceof Error ? error.message : error,
    );
    return { created: false, reason: 'unexpected_error' };
  }
}

/** Re-exported for the webhook's own duplicate check. */
export { isCaseCreationClaimToken };
