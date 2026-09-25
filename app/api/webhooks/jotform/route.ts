import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { verifyJotformWebhook } from '@/lib/jotform/jotformWebhookVerification';
import { parseJotformWebhookBody, extractHiddenFieldByQid } from '@/domain/externalForms/parseWebhookPayload';
import { extractMappedFieldsForForm } from '@/domain/externalForms/arrangementNokDerivation';
import * as externalFormConfigService from '@/services/externalFormConfigService';
import * as caseFormLinkService from '@/services/caseFormLinkService';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';
import { preservePdfForSubmission } from '@/services/externalFormPdfService';
import { recordExternalFormSubmissionReceived, recordExternalFormSubmissionUnmatched } from '@/services/activityService';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). Public
 * endpoint — no session, no cookie, no organizationId trusted from the
 * request. Deliberately exempt from `requireSameOrigin` for the same
 * reason `app/api/webhooks/clover/route.ts` is: this is never a
 * cookie-riding request, and its own authenticity check
 * (`verifyJotformWebhook`) is the appropriate mechanism here, not a
 * substitute for one.
 *
 * CRITICAL INVARIANT, enforced structurally (see this route's own
 * structural test): this handler NEVER imports or calls
 * `reserveNextCaseNumber`, `POST /api/cases`'s handler, or any case-
 * creation path. A submission that cannot be matched to an existing
 * `CaseFormLink` is stored as `status: 'unmatched'` and nothing else
 * happens — no case is created, no case number is allocated, no case
 * sequence is touched, regardless of how confident the submission's own
 * content looks.
 *
 * Organization is resolved exclusively from Solis's own stored
 * `ExternalFormConfig` (keyed by provider + the webhook's own formID) —
 * never trusted from anything in the request body itself, mirroring the
 * Clover webhook's own organization-resolution principle.
 *
 * Jotform hidden-field identifier correction (2026-09) — RESOLUTION
 * ORDER, deliberately restructured from this route's earlier design:
 *   1. Body-size checks (unchanged, before any parsing).
 *   2. Bounded parse (`parseJotformWebhookBody`) — extracts `formId` only
 *      as far as needed to look up a config; a malformed body (no
 *      resolvable formId) is rejected here, 400, before anything else.
 *   3. Resolve a TRUSTED, server-side `ExternalFormConfig` for that
 *      formId (enabled only). An unrecognized or disabled form is
 *      rejected outright (404) — no auth-field guessing is attempted, no
 *      submission row is created, no case-related action is taken.
 *   4. Using ONLY that trusted config's own `webhookAuthFieldQid` —
 *      never a qid or name supplied by the request — extract the auth
 *      value and verify it. Invalid/missing auth is rejected (401).
 *   5. Using that same trusted config's `linkTokenFieldQid`, extract
 *      `solisLinkToken` and resolve the matching `CaseFormLink`.
 * The request can never choose which qid is treated as the auth field —
 * both qids are only ever read from the config resolved in step 3.
 *
 * Disclosed, deliberate change from the prior design: because auth
 * verification now depends on resolving a per-form config first, a
 * malformed body (400) and an unrecognized form (404) are now
 * distinguishable from a wrong/missing secret (401) by response code —
 * unlike the prior design's uniform pre-parse 401. This is an unavoidable
 * consequence of per-form qid resolution and is an acceptable tradeoff:
 * a Jotform formId is not itself secret (it's derivable from the form's
 * own public URL).
 *
 * The auth value is never logged, never included in any response, and
 * never persisted — it has no qid mapped in fieldMapping.ts, so it
 * structurally cannot appear in `answers`/`mappedFields` either.
 */
const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024; // 2MB — generous for a funeral-intake form's rawRequest JSON blob, bounded against abuse

export async function POST(request: Request) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
  }

  let fields: Record<string, unknown>;
  try {
    const formData = await request.formData();
    fields = Object.fromEntries(formData.entries());
  } catch {
    return NextResponse.json({ error: 'Invalid webhook payload.' }, { status: 400 });
  }

  // Defense-in-depth: Content-Length can be absent or inaccurate.
  const approxBytes = Object.entries(fields).reduce((sum, [key, value]) => sum + key.length + String(value).length, 0);
  if (approxBytes > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
  }

  const parsed = parseJotformWebhookBody(fields);
  if (!parsed) {
    return NextResponse.json({ error: 'Malformed webhook payload — missing formID/submissionID.' }, { status: 400 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const config = await externalFormConfigService.findByProviderFormId('jotform', parsed.formId, dataAdapterMode);
  if (!config) {
    // Unknown or disabled form: reject outright. No auth-field guessing,
    // no submission row, no case-related action — see the module doc
    // comment for why this is now a rejection rather than a soft 200 ack.
    return NextResponse.json({ error: 'Unrecognized or disabled form.' }, { status: 404 });
  }

  const authValue = extractHiddenFieldByQid(parsed, config.webhookAuthFieldQid);
  const verification = verifyJotformWebhook(authValue);
  if (!verification.valid) {
    return NextResponse.json({ error: `Webhook verification failed (${verification.reason}).` }, { status: 401 });
  }

  const rawLinkToken = extractHiddenFieldByQid(parsed, config.linkTokenFieldQid);
  const resolvedLink = rawLinkToken ? await caseFormLinkService.resolveByRawToken(rawLinkToken, dataAdapterMode) : null;

  const mappedFields = extractMappedFieldsForForm(config.provider, config.externalFormId, parsed.answers);

  const correlationId = crypto.randomUUID();
  const activityCtx = {
    organizationId: config.organizationId,
    actorIdentityId: null,
    actorMembershipId: null,
    actorRoleKey: null,
    correlationId,
    isSystemGenerated: true,
  };

  const { submission, wasNew } = await externalFormSubmissionService.receive(
    {
      organizationId: config.organizationId,
      provider: config.provider,
      externalFormId: config.externalFormId,
      externalSubmissionId: parsed.submissionId,
      caseFormLinkId: resolvedLink?.id ?? null,
      mappedFields: JSON.stringify(mappedFields),
      pdfStatus: 'pending',
    },
    dataAdapterMode,
  );

  if (!wasNew) {
    // Redelivery of an already-known submission — fully idempotent,
    // nothing further to do (matched/unmatched state and PDF status were
    // already resolved on first receipt).
    return NextResponse.json({ received: true });
  }

  if (resolvedLink) {
    await caseFormLinkService.markReceived(resolvedLink.id, submission.id, dataAdapterMode);
    try {
      await recordExternalFormSubmissionReceived(activityCtx, resolvedLink.caseId, submission.id, config.label, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record external_form.submission_received activity event:', error instanceof Error ? error.message : error);
    }

    // PDF preservation is independent of, and never blocks, the
    // submission's own receipt — a failure here is recorded on the
    // submission itself (pdfStatus: 'failed') and retried later, never
    // surfaced as a webhook failure to Jotform.
    await preservePdfForSubmission(submission, resolvedLink.caseId, activityCtx, dataAdapterMode);
  } else {
    try {
      await recordExternalFormSubmissionUnmatched(activityCtx, submission.id, config.label, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record external_form.submission_unmatched activity event:', error instanceof Error ? error.message : error);
    }
  }

  return NextResponse.json({ received: true });
}
