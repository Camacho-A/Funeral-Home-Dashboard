import crypto from 'crypto';
import { applyArrangementNokRelationship } from '@/services/externalForms/nokRelationshipAutofillService';
import { recordSlaEventAutomatically } from '@/services/slaService';
import { completeArrangementFormChecklistItem } from '@/services/automaticChecklistCompletion';
import { loadCaseOnServer } from '@/services/serverCaseLoader';
import { NextResponse } from 'next/server';
import { getDataAdapterMode } from '@/lib/env';
import { composeDecedentName } from '@/domain/cases/decedentName';
import { authenticateJotformSubmission } from '@/lib/jotform/jotformSubmissionAuthenticity';
import { parseJotformWebhookBody, extractHiddenFieldByQid } from '@/domain/externalForms/parseWebhookPayload';
import { extractMappedFieldsForForm } from '@/domain/externalForms/arrangementNokDerivation';
import * as externalFormConfigService from '@/services/externalFormConfigService';
import * as caseFormLinkService from '@/services/caseFormLinkService';
import * as externalFormSubmissionService from '@/services/externalFormSubmissionService';
import { preservePdfForSubmission } from '@/services/externalFormPdfService';
import { recordExternalFormSubmissionReceived, recordExternalFormSubmissionUnmatched } from '@/services/activityService';
import { reconcileCaseWorkflow } from '@/services/workflowReconciliationService';
import { createCaseFromIntakeSubmission } from '@/services/externalFormIntakeService';
import { attachToExistingCase, type ExistingCaseAttachmentOutcome } from '@/services/existingCaseAttachmentService';
import { notifyIntakeSubmissionNeedsAttention } from '@/services/intakeNotifications';
import {
  notifyCaseCreated,
  notifyArrangementReceived,
  notifyVitalStatisticsReceived,
  notifyJotformPdfImported,
  notifyJotformPdfImportFailed,
  type CaseNotificationOrigin,
  type NotifiableCase,
} from '@/services/caseNotifications';
import { resolveFormRole, type ExternalFormRole } from '@/domain/externalForms/formRegistry';
import { isOrganizationAllowedInDeployment } from '@/lib/auth/deploymentOrganizations';

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
 * MULTI-TENANT HARDENING (2026-10) — one Beacon backend, several
 * organizations:
 *   - Step 3 reads EVERY enabled config for the formId
 *     (`resolveByProviderFormId`). More than one (the same Jotform form
 *     configured in two organizations, or twice in one), or a config that
 *     fails validation, is rejected 409 BEFORE Jotform is called and
 *     before anything is written — the delivery is logged by form id and
 *     organization ids only, never processed into any organization. There
 *     is no "first match wins".
 *   - The resolved organization must be served by THIS deployment
 *     (`isOrganizationAllowedInDeployment`). Otherwise the delivery is
 *     answered exactly like an unknown form (404) — nothing written, and
 *     nothing revealed about which deployment owns the form.
 *   - Verification uses the config's own `apiKeyReference` (an env var
 *     name; default `JOTFORM_API_KEY`), so an organization with its own
 *     Jotform account is verified with its own key.
 *   - Form-specific behaviour (field mapping, notifications, PDF document
 *     type) comes from the organization-aware registry
 *     (domain/externalForms/formRegistry.ts), never from comparing against
 *     another organization's form ids. An unregistered form is handled
 *     generically.
 *   - A link token only ever updates a case of the config's OWN
 *     organization (see the guard below); link tokens are only issued
 *     after an organization-scoped case lookup (generate-link route).
 *
 * `webhookAuthFieldQid` remains on the config type and on the live rows
 * but is NO LONGER READ by this handler. It is retained rather than
 * dropped so that retiring the mechanism does not require a data
 * migration in the same change; see docs/JOTFORM_INTEGRATION.md for the
 * cleanup that is now safe to perform.
 */
const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024; // 2MB — generous for a funeral-intake form's rawRequest JSON blob, bounded against abuse

/**
 * Which form a submission came through, in the words a notification uses.
 *
 * Everyday notifications (2026-10): one `case.created` type carries its
 * origin in the body rather than fragmenting the inbox into one type per
 * form — the staff action is the same however the case arrived.
 */
function creationSourceFor(role: ExternalFormRole | null): CaseNotificationOrigin {
  if (role === 'arrangement') return 'the Cremation Arrangement Form';
  if (role === 'first_call') return 'the First Call form';
  return 'an intake form';
}

/**
 * The case a notification describes, looked up only to name it.
 *
 * Returns null rather than throwing: announcing is best-effort, and a case
 * that cannot be read is a case not worth announcing — never a reason to
 * fail the webhook that already stored the submission.
 */
async function notifiableCase(
  caseId: string,
  organizationId: string,
  dataAdapterMode: ReturnType<typeof getDataAdapterMode>,
): Promise<NotifiableCase | null> {
  try {
    const found = await loadCaseOnServer(organizationId, caseId, dataAdapterMode);
    if (!found) return null;
    return {
      id: found.id,
      caseNumber: found.caseNumber,
      decedentName: composeDecedentName(found.decedentName, found.decedentMiddleName),
    };
  } catch (error) {
    console.error('Failed to load the case for a notification:', error instanceof Error ? error.message : error);
    return null;
  }
}

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
  const resolution = await externalFormConfigService.resolveByProviderFormId('jotform', parsed.formId, dataAdapterMode);
  if (resolution.status === 'ambiguous' || resolution.status === 'invalid') {
    // Fail closed: the owning organization cannot be decided safely, so
    // nothing is verified, stored or attached anywhere. Logged by form id
    // and organization ids only — never submission content.
    console.error(
      `[POST /api/webhooks/jotform] Form ${parsed.formId} has ${resolution.status} configuration (${
        resolution.issues.map((i) => `${i.code}:${i.organizationIds.join('|')}`).join(', ') || 'unmappable row'
      }) — delivery ${parsed.submissionId} rejected, nothing processed.`,
    );
    return NextResponse.json({ error: 'Form configuration conflict — delivery not processed.' }, { status: 409 });
  }
  if (resolution.status !== 'resolved') {
    // Unknown or disabled form: reject outright. No auth-field guessing,
    // no submission row, no case-related action — see the module doc
    // comment for why this is now a rejection rather than a soft 200 ack.
    return NextResponse.json({ error: 'Unrecognized or disabled form.' }, { status: 404 });
  }
  const config = resolution.config;

  // Deployment boundary: a form belonging to an organization this
  // deployment does not serve is answered exactly like an unknown form —
  // no Jotform call, no write, and no hint of where the form does belong.
  if (!isOrganizationAllowedInDeployment(config.organizationId)) {
    console.error(
      `[POST /api/webhooks/jotform] Form ${config.externalFormId} belongs to an organization this deployment does not serve — delivery not processed.`,
    );
    return NextResponse.json({ error: 'Unrecognized or disabled form.' }, { status: 404 });
  }
  const formRole = resolveFormRole(config);

  // Authenticate against Jotform itself. Everything below this point
  // uses `authenticated.answers` — Jotform's own record of what was
  // submitted — and never `parsed.answers`/`parsed.rawRequest`, which an
  // attacker controls.
  const authenticated = await authenticateJotformSubmission({
    claimedFormId: config.externalFormId,
    claimedSubmissionId: parsed.submissionId,
    ...(config.apiKeyReference ? { apiKeyReference: config.apiKeyReference } : {}),
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

  const mappedFields = extractMappedFieldsForForm(config, authenticated.answers);

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
   * Automated form intake (2026-10). ANY form explicitly configured
   * `purpose: 'case_create'` creates one case when its submission has no
   * case to attach to — at Manors that is both the First Call Sheet and
   * the Cremation Arrangement Forms, because staff take calls overnight
   * and frequently submit the Arrangement first. A `case_update` form,
   * and any `case_create` submission that DID resolve a link, falls
   * through to the unchanged behavior below.
   *
   * A resolved link always wins: this branch is only reached when no
   * link resolved, so a submission carrying a valid case-link token
   * updates its own case and can never create a second one.
   *
   * Duplicate protection is three-layered: the `wasNew` gate above (a
   * redelivered submission never gets here), the compare-and-swap claim
   * inside `createCaseFromIntakeSubmission` (two concurrent deliveries
   * of one submission cannot both create), and that function's own
   * duplicate-candidate guard (a DIFFERENT submission describing a case
   * SOLIS already has is held for staff review instead of creating a
   * second case).
   */
  if (!resolvedLink && config.purpose === 'case_create') {
    const outcome = await createCaseFromIntakeSubmission(
      { config, submission, mappedFields, request },
      activityCtx,
      dataAdapterMode,
    );
    // A failure is deliberately NOT surfaced to Jotform as an error: the
    // submission row is already stored, so retrying the delivery would
    // short-circuit at `wasNew` and never re-attempt creation anyway. The
    // row stays `unmatched` and is visible in Unmatched Forms, which is
    // the existing recovery path staff already use.
    //
    // Attaching to the case it belongs to (2026-10): a submission held
    // only because ONE existing case already describes this death — the
    // everyday Manors order, First Call first and the Arrangement filled
    // in directly on Jotform afterwards — is attached to that case
    // instead of waiting for a manual import. The conditions live in
    // domain/externalForms/existingCaseAttachment.ts; anything less
    // certain still goes to staff below.
    if (!outcome.created && outcome.reason === 'duplicate_review_required') {
      let attachment: ExistingCaseAttachmentOutcome;
      try {
        attachment = await attachToExistingCase(
          { config, submission, mappedFields, candidates: outcome.duplicateCandidates ?? [] },
          activityCtx,
          dataAdapterMode,
        );
      } catch (error) {
        console.error(
          `[POST /api/webhooks/jotform] Attaching submission ${submission.id} to its existing case failed — left for staff review:`,
          error instanceof Error ? error.message : error,
        );
        attachment = { attached: false, reason: 'case_not_found' };
      }
      if (attachment.attached) {
        await completeOnExistingCase(attachment.caseId, attachment.submission);
        return NextResponse.json({ received: true, caseCreated: false, attachedToCaseId: attachment.caseId });
      }
      console.error(
        `[POST /api/webhooks/jotform] Submission ${submission.id} not attached automatically (${attachment.reason}) — left for staff review.`,
      );
    }
    //
    // Automatic intake failure visibility (2026-10): the reason is
    // recorded ON the submission, not only in a server log, so Unmatched
    // Forms can tell staff WHY this one needs them rather than leaving an
    // unexplained row for someone to puzzle over. Best-effort — the
    // submission is already stored, and failing to annotate it must never
    // be what loses it.
    if (!outcome.created) {
      try {
        await externalFormSubmissionService.recordCaseCreationFailure(submission.id, outcome.reason, dataAdapterMode);
      } catch (error) {
        console.error(
          'Failed to record the case-creation failure reason on the submission:',
          error instanceof Error ? error.message : error,
        );
      }
      // Intake activation (2026-10): annotating the row told staff WHY,
      // but only once they went looking. This tells them it happened.
      // In-app only, best-effort, and idempotent per (submission,
      // recipient) — see services/intakeNotifications.ts.
      await notifyIntakeSubmissionNeedsAttention(
        activityCtx,
        {
          submissionId: submission.id,
          formLabel: config.label,
          submissionReference: submission.externalSubmissionId,
          // A duplicate candidate means SOLIS deliberately HELD the
          // submission for a person to judge, which is a different thing
          // from creation failing — staff should see which it was.
          reason:
            (outcome.duplicateCandidates?.length ?? 0) > 0
              ? 'Needs manual review before a case is created'
              : 'Automatic case creation failed',
          receivedAt: submission.receivedAt,
        },
        dataAdapterMode,
      );
    }

    /**
     * Arrangement-first PDF import (2026-10). THE BUG: this branch used
     * to return here, and `preservePdfForSubmission` is called only in
     * the `resolvedLink` branch below — which a case created from this
     * very submission never reaches. So a case created Arrangement-first
     * never had its PDF imported, and its submission sat at
     * `pdfStatus: 'pending'` forever: not failed, not retried, with no
     * reason recorded, because the import was never attempted at all.
     * B2026-038 is exactly that; B2026-037 only has its PDF because
     * somebody recovered it by hand through the manual link/retry route.
     *
     * A First Call was never literally the prerequisite — a pre-existing
     * CaseFormLink was, which is what a First Call-created case happens
     * to have. The case and its link both exist by the time we get here,
     * so the same preservation call the update path makes works
     * unchanged.
     *
     * Same contract as that call: best-effort, never blocks or fails the
     * webhook, and idempotent — `preservePdfForSubmission` short-circuits
     * on `pdfStatus === 'stored'`, so a redelivery never uploads twice.
     */
    if (outcome.created) {
      const refreshed = await externalFormSubmissionService.getById(submission.id, dataAdapterMode);
      const pdfResult = await preservePdfForSubmission(refreshed ?? submission, outcome.caseId, activityCtx, dataAdapterMode, { config });
      if (formRole === 'arrangement') await applyArrangementNokRelationship(activityCtx, outcome.caseId, refreshed ?? submission, dataAdapterMode);

      /**
       * Everyday notifications (2026-10). ONE notification for a case this
       * submission created, naming the form it came from — never both a
       * "new case" and a separate "arrangement received" for the same
       * arrival. Keyed on the case id, so a webhook redelivery announces
       * nothing the second time.
       */
      // SLA tracking (2026-10): a case created by the Vital Statistics form
      // has the family's paperwork from the start.
      if (formRole === 'vital_statistics') {
        try {
          await recordSlaEventAutomatically(config.organizationId, outcome.caseId, 'vital_statistics_received', submission.receivedAt, dataAdapterMode);
        } catch (error) {
          console.error('Failed to record Vital Statistics receipt for SLA tracking:', error instanceof Error ? error.message : error);
        }
      }

      const created = await notifiableCase(outcome.caseId, config.organizationId, dataAdapterMode);
      if (created) {
        await notifyCaseCreated(activityCtx, { case: created, source: creationSourceFor(formRole) }, dataAdapterMode);
        // `already_stored` is the idempotent retry finding the document
        // already attached — not news, and deliberately silent.
        if (pdfResult.outcome === 'stored') {
          await notifyJotformPdfImported(
            activityCtx,
            { case: created, submissionId: submission.id, formLabel: config.label },
            dataAdapterMode,
          );
        } else if (pdfResult.outcome === 'failed') {
          await notifyJotformPdfImportFailed(
            activityCtx,
            { case: created, submissionId: submission.id, formLabel: config.label },
            dataAdapterMode,
          );
        }
      }
    }

    return NextResponse.json({ received: true, caseCreated: outcome.created });
  }

  if (resolvedLink) {
    await caseFormLinkService.markReceived(resolvedLink.id, submission.id, dataAdapterMode);
    try {
      await recordExternalFormSubmissionReceived(activityCtx, resolvedLink.caseId, submission.id, config.label, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record external_form.submission_received activity event:', error instanceof Error ? error.message : error);
    }
    await completeOnExistingCase(resolvedLink.caseId, submission);
  } else {
    try {
      await recordExternalFormSubmissionUnmatched(activityCtx, submission.id, config.label, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record external_form.submission_unmatched activity event:', error instanceof Error ? error.message : error);
    }
    await notifyIntakeSubmissionNeedsAttention(
      activityCtx,
      {
        submissionId: submission.id,
        formLabel: config.label,
        submissionReference: submission.externalSubmissionId,
        reason: 'Could not be matched to a case',
        receivedAt: submission.receivedAt,
      },
      dataAdapterMode,
    );
  }

  return NextResponse.json({ received: true });

  /**
   * Everything that follows a submission landing on a case that already
   * existed — through its link token, or attached automatically above.
   */
  async function completeOnExistingCase(caseId: string, landed: typeof submission) {
    // PDF preservation is independent of, and never blocks, the
    // submission's own receipt — a failure here is recorded on the
    // submission itself (pdfStatus: 'failed') and retried later, never
    // surfaced as a webhook failure to Jotform.
    const pdfResult = await preservePdfForSubmission(landed, caseId, activityCtx, dataAdapterMode, { config });

    // Next of Kin relationship (2026-10): filled in from the Arrangement
    // Form when the case's is still blank and it is safe to; flagged for
    // review otherwise. Best-effort; never fails the webhook.
    if (formRole === 'arrangement') await applyArrangementNokRelationship(activityCtx, caseId, landed, dataAdapterMode);

    /**
     * A form that landed on a case that already existed. Keyed on the
     * submission id, so a redelivery is a no-op; the case-creation branch
     * never announces through here as well, so no arrival is announced
     * twice.
     */
    const updated = await notifiableCase(caseId, config.organizationId, dataAdapterMode);
    if (updated) {
      if (formRole === 'arrangement') {
        await notifyArrangementReceived(activityCtx, { case: updated, submissionId: submission.id }, dataAdapterMode);
      } else if (formRole === 'vital_statistics') {
        await notifyVitalStatisticsReceived(activityCtx, { case: updated, submissionId: submission.id }, dataAdapterMode);
        // SLA tracking (2026-10): the family's paperwork is in. The first
        // receipt time is kept; best-effort, never fails the webhook.
        try {
          await recordSlaEventAutomatically(config.organizationId, caseId, 'vital_statistics_received', submission.receivedAt, dataAdapterMode);
        } catch (error) {
          console.error('Failed to record Vital Statistics receipt for SLA tracking:', error instanceof Error ? error.message : error);
        }
      }
      if (pdfResult.outcome === 'stored') {
        await notifyJotformPdfImported(
          activityCtx,
          { case: updated, submissionId: submission.id, formLabel: config.label },
          dataAdapterMode,
        );
      } else if (pdfResult.outcome === 'failed') {
        await notifyJotformPdfImportFailed(
          activityCtx,
          { case: updated, submissionId: submission.id, formLabel: config.label },
          dataAdapterMode,
        );
      }
    }

    // Manors workflow reconciliation (2026-09): a normally-received
    // submission is exactly the same "Arrangement Form now linked" fact
    // the historical-import path produces — reuses the identical
    // reconciliation call so both paths can never diverge in meaning.
    // Automatic checklist completion (2026-10, Manors): the received
    // Arrangement Form completes "Jotform application completed" before
    // reconciliation reads the checklist. Best-effort.
    try {
      await completeArrangementFormChecklistItem(config.organizationId, caseId, dataAdapterMode);
    } catch (error) {
      console.error('Failed to complete the Arrangement Form checklist item automatically:', error instanceof Error ? error.message : error);
    }
    await reconcileCaseWorkflow(config.organizationId, caseId, dataAdapterMode);
  }
}
