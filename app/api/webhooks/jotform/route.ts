import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { verifyJotformWebhook } from '@/lib/jotform/jotformWebhookVerification';
import { parseJotformWebhookBody, extractWebhookAuthValue } from '@/domain/externalForms/parseWebhookPayload';
import { extractMappedFields } from '@/domain/externalForms/extractMappedFields';
import { fieldMapForForm } from '@/domain/externalForms/fieldMapping';
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
 * Jotform pre-production hardening (2026-09):
 * - Authentication now depends on request-body content (the hidden
 *   `solisWebhookAuth` field), so a size check runs BEFORE any body is
 *   read (Content-Length precheck) and again just after parsing (an
 *   aggregate-size check over the parsed fields, defense-in-depth against
 *   an absent/understated Content-Length) — see MAX_WEBHOOK_BODY_BYTES.
 *   This is not a byte-perfect streaming cap: `Request.formData()`
 *   buffers the body internally before this handler ever sees it, and
 *   neither this runtime nor this codebase currently exposes a
 *   lower-level streaming body reader — a known, disclosed limitation,
 *   not a silent gap.
 * - Auth is checked (`extractWebhookAuthValue` + `verifyJotformWebhook`)
 *   BEFORE the full `parseJotformWebhookBody` parse, and independently of
 *   whether the rest of the body is well-formed — so an unauthenticated
 *   caller always gets 401 regardless of body validity, never able to
 *   distinguish "malformed" from "wrong secret" by response shape.
 * - The auth value is never logged, never included in any response, and
 *   never persisted — it has no qid, so it structurally cannot appear in
 *   `answers`/`mappedFields` either.
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

  const authValue = extractWebhookAuthValue(fields);
  const verification = verifyJotformWebhook(authValue);
  if (!verification.valid) {
    return NextResponse.json({ error: `Webhook verification failed (${verification.reason}).` }, { status: 401 });
  }

  const parsed = parseJotformWebhookBody(fields);
  if (!parsed) {
    return NextResponse.json({ error: 'Malformed webhook payload — missing formID/submissionID.' }, { status: 400 });
  }

  const dataAdapterMode = getDataAdapterMode();
  const config = await externalFormConfigService.findByProviderFormId('jotform', parsed.formId, dataAdapterMode);
  if (!config) {
    // Nothing actionable — an unrecognized form, never retried.
    return NextResponse.json({ received: true });
  }

  const rawLinkToken = parsed.rawFieldsByName.get(config.linkTokenFieldName) ?? null;
  const resolvedLink = rawLinkToken ? await caseFormLinkService.resolveByRawToken(rawLinkToken, dataAdapterMode) : null;

  const fieldMap = fieldMapForForm(config.provider, config.externalFormId);
  const mappedFields = extractMappedFields(fieldMap, parsed.answers);

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
