import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { authenticateJotformSubmission } from '@/lib/jotform/jotformSubmissionAuthenticity';
import { parseJotformWebhookBody, extractHiddenFieldByQid } from '@/domain/externalForms/parseWebhookPayload';
import { extractMappedFieldsForForm } from '@/domain/externalForms/arrangementNokDerivation';
import * as externalFormConfigService from '@/services/externalFormConfigService';
import * as caseFormLinkService from '@/services/caseFormLinkService';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';
import { preservePdfForSubmission } from '@/services/externalFormPdfService';
import { recordExternalFormSubmissionReceived, recordExternalFormSubmissionUnmatched } from '@/services/activityService';
import { reconcileCaseWorkflow } from '@/services/workflowReconciliationService';
import { createCaseFromFirstCallSubmission } from '@/services/externalFormIntakeService';

/**
 * Manors Jotform integration (case-first architecture, 2026-09). Public
 * endpoint — no session, no cookie, no organizationId trusted from the
 * request. Deliberately exempt from `requireSameOrigin` for the same
 * reason `app/api/webhooks/clover/route.ts` is: this is never a
 * cookie-riding request, and its own authenticity check is the
 * appropriate mechanism here, not a substitute for one.
 *
 * SERVER-SIDE AUTHENTICATION (2026-10) — the request body is NOT trusted,
 * as data or as proof.
 *
 * This handler previously authenticated a delivery with a shared secret
 * carried in a Jotform hidden field (`solisWebhookAuth`). That was not
 * authentication: a hidden field is hidden only from the rendering, and
 * its default value ships inside the public form's own markup, so any
 * form submitter could read the secret and then POST an entirely forged
 * body here. That check is RETIRED.
 *
 * In its place, the delivery is treated as an untrusted notification
 * carrying exactly two claims — `formID` and `submissionID` — which are
 * verified against Jotform itself through an authenticated API call keyed
 * by the server-only `JOTFORM_API_KEY`
 * (`lib/jotform/jotformSubmissionAuthenticity.ts`, which also records why
 * Jotform offers no signature to verify and why a URL-embedded secret was
 * rejected). The submission's answers are then taken from THAT API
 * response. The body's own `rawRequest` is used for nothing but the two
 * claims above, so forged answers cannot reach a case.
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
 * RESOLUTION ORDER:
 *   1. Body-size checks, before any parsing.
 *   2. Bounded parse (`parseJotformWebhookBody`) — reads `formID` and
 *      `submissionID` only; a malformed body is rejected here, 400.
 *   3. Resolve a TRUSTED, server-side `ExternalFormConfig` for that
 *      formId (enabled only). An unrecognized or disabled form is
 *      rejected outright (404) — no submission row is created and no
 *      case-related action is taken.
 *   4. Authenticate the two claims against Jotform's own API. This both
 *      proves the submission exists and is owned by this account, and
 *      yields the AUTHORITATIVE answers used from here on. A delivery
 *      that cannot be verified is rejected (401), or 503 when Jotform
 *      itself could not be reached so that the delivery is retried
 *      rather than silently lost.
 *   5. Using the trusted config's `linkTokenFieldQid`, read
 *      `solisLinkToken` out of those AUTHORITATIVE answers and resolve
 *      the matching `CaseFormLink`. Reading the link token from Jotform
 *      rather than from the body matters on its own: otherwise a forged
 *      body could pair a genuine submission id with a link token of the
 *      attacker's choosing and attach a real submission to a case it
 *      does not belong to.
 * The request can never choose which qid is read — the qid comes only
 * from the config resolved in step 3.
 *
 * Response codes deliberately distinguish a malformed body (400) and an
 * unrecognized form (404) from a failed authentication (401). A Jotform
 * formId is not secret — it is derivable from the form's own public URL —
 * so this leaks nothing.
 *
 * `webhookAuthFieldQid` remains on the config type and on the live rows
 * but is NO LONGER READ by this handler. It is retained rather than
 * dropped so that retiring the mechanism does not require a data
 * migration in the same change; see docs/JOTFORM_INTEGRATION.md for the
 * cleanup that is now safe to perform.
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

  // Authenticate against Jotform itself. Everything below this point
  // uses `authenticated.answers` — Jotform's own record of what was
  // submitted — and never `parsed.answers`/`parsed.rawRequest`, which an
  // attacker controls.
  const authenticated = await authenticateJotformSubmission({
    claimedFormId: config.externalFormId,
    claimedSubmissionId: parsed.submissionId,
  });
  if (!authenticated.authentic) {
    return NextResponse.json(
      { error: `Webhook verification failed (${authenticated.reason}).` },
      { status: authenticated.status },
    );
  }

  const authoritative = { answers: authenticated.answers, rawRequest: {} };

  // A `case_create` form has no link-token field at all (its config
  // carries an empty qid), so this never attempts a lookup for one.
  const rawLinkToken = config.linkTokenFieldQid
    ? extractHiddenFieldByQid(authoritative, config.linkTokenFieldQid)
    : null;
  const tokenLink = rawLinkToken ? await caseFormLinkService.resolveByRawToken(rawLinkToken, dataAdapterMode) : null;

  // Multi-tenant guard (2026-10). `resolveByRawToken` looks a link up by
  // token hash ALONE, with no organization filter — so a token issued by
  // organization A, replayed through a form owned by organization B, would
  // otherwise have this handler mark A's CaseFormLink received and
  // reconcile A's case while filing the submission under B. Treat any such
  // mismatch as no link at all: the submission is stored unmatched for
  // staff to resolve, and no cross-tenant write happens.
  const resolvedLink = tokenLink && tokenLink.organizationId === config.organizationId ? tokenLink : null;
  if (tokenLink && !resolvedLink) {
    console.error(
      `[POST /api/webhooks/jotform] Link token resolved to organization ${tokenLink.organizationId} but form ${config.externalFormId} belongs to ${config.organizationId} — treating as unmatched.`,
    );
  }

  const mappedFields = extractMappedFieldsForForm(config.provider, config.externalFormId, authenticated.answers);

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

  /**
   * Automated first-call intake (2026-10). A form explicitly configured
   * `purpose: 'case_create'` creates one case when its submission has no
   * case to attach to. Every other form, and any `case_create` submission
   * that DID resolve a link, falls through to the unchanged behavior
   * below — so this can only ever add a case where the old code would
   * have left an unmatched row, never change what an existing form does.
   *
   * Duplicate protection is the `wasNew` gate above plus the
   * compare-and-swap claim inside `createCaseFromFirstCallSubmission`:
   * the same submission delivered twice produces exactly one case, and
   * the second delivery returns here without reaching this branch at all.
   */
  if (!resolvedLink && config.purpose === 'case_create') {
    const outcome = await createCaseFromFirstCallSubmission(
      { config, submission, mappedFields, request },
      activityCtx,
      dataAdapterMode,
    );
    // A failure is deliberately NOT surfaced to Jotform as an error: the
    // submission row is already stored, so retrying the delivery would
    // short-circuit at `wasNew` and never re-attempt creation anyway. The
    // row stays `unmatched` and is visible in Unmatched Forms, which is
    // the existing recovery path staff already use.
    return NextResponse.json({ received: true, caseCreated: outcome.created });
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

    // Manors workflow reconciliation (2026-09): a normally-received
    // submission is exactly the same "Arrangement Form now linked" fact
    // the historical-import path produces — reuses the identical
    // reconciliation call so both paths can never diverge in meaning.
    await reconcileCaseWorkflow(config.organizationId, resolvedLink.caseId, dataAdapterMode);
  } else {
    try {
      await recordExternalFormSubmissionUnmatched(activityCtx, submission.id, config.label, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record external_form.submission_unmatched activity event:', error instanceof Error ? error.message : error);
    }
  }

  return NextResponse.json({ received: true });
}
