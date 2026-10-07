import type { DataAdapterMode } from '../lib/env';
import type { ExternalFormConfig } from '../types/externalFormConfig';
import type { ExternalFormSubmission } from '../types/externalFormSubmission';
import type { MappedSolisField } from '../domain/externalForms/fieldMapping';
import { isCaseCreationClaimToken } from '../types/externalFormSubmission';
import { createExternalFormIntakeAuthorization } from '../lib/auth/externalFormIntakeAuthorization';
import * as externalFormSubmissionService from './externalFormSubmissionService';
import * as staffProfileService from './staffProfileService';
import { reconcileCaseWorkflow } from './workflowReconciliationService';
import { recordExternalFormSubmissionLinked, type ActivityContext } from './activityService';

/**
 * Automated first-call intake (2026-10). Turns a verified Jotform
 * submission from a `purpose: 'case_create'` form into exactly one Solis
 * case.
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

export type FirstCallIntakeOutcome =
  | { created: true; caseId: string; caseNumber: string }
  | { created: false; reason: string };

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

export async function createCaseFromFirstCallSubmission(
  params: {
    config: ExternalFormConfig;
    submission: ExternalFormSubmission;
    mappedFields: Partial<Record<MappedSolisField, string>>;
    request: Request;
  },
  activityCtx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<FirstCallIntakeOutcome> {
  const { config, submission, mappedFields, request } = params;

  const missing = REQUIRED_FOR_CREATION.filter((field) => !mappedFields[field]?.trim());
  if (missing.length > 0) {
    // Fail safely: the submission stays `unmatched` and appears in
    // Unmatched Forms, where staff can attach it to a case by hand. A
    // case is never created from partial data, and nothing is guessed.
    console.error(
      `[first-call intake] Submission ${submission.id} is missing required field(s) (${missing.join(', ')}) — left unmatched, no case created.`,
    );
    return { created: false, reason: `missing_required_fields:${missing.join(',')}` };
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
        `[first-call intake] Organization ${config.organizationId} has no active staff profile to attribute an intake case to — left unmatched.`,
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
        ...(mappedFields.dateOfBirth ? { dateOfBirth: mappedFields.dateOfBirth } : {}),
        ...(mappedFields.dateOfDeath ? { dateOfDeath: mappedFields.dateOfDeath } : {}),
        ...(mappedFields.timeOfDeath ? { timeOfDeath: mappedFields.timeOfDeath } : {}),
        ...(mappedFields.placeOfDeath ? { placeOfDeath: mappedFields.placeOfDeath } : {}),
        ...(mappedFields.weight ? { weight: mappedFields.weight } : {}),
        ...(mappedFields.nextOfKinEmail ? { nextOfKinEmail: mappedFields.nextOfKinEmail } : {}),
        externalFormIntakeAuthorization,
      }),
    });

    if (!caseResponse.ok) {
      await externalFormSubmissionService.revertCaseCreationClaim(submission.id, claim.claimToken, dataAdapterMode);
      const body = await caseResponse.json().catch(() => null);
      console.error(
        `[first-call intake] POST /api/cases failed for submission ${submission.id} (HTTP ${caseResponse.status}): ${body?.error ?? 'unknown error'}`,
      );
      return { created: false, reason: `case_creation_failed:${caseResponse.status}` };
    }

    const created = (await caseResponse.json()).case as { id: string; caseNumber: string };
    await externalFormSubmissionService.markCaseCreated(submission.id, created.id, dataAdapterMode);

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
      `[first-call intake] Unexpected failure creating a case for submission ${submission.id}:`,
      error instanceof Error ? error.message : error,
    );
    return { created: false, reason: 'unexpected_error' };
  }
}

/** Re-exported for the webhook's own duplicate check. */
export { isCaseCreationClaimToken };
