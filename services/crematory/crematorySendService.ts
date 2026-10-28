import crypto from 'crypto';
import type { DataAdapterMode } from '@/lib/env';
import type { ActivityContext } from '../activityService';
import { recordCrematoryEvent } from '../activityService';
import { ACTIVITY_EVENT_TYPES } from '@/types/activityEvent';
import { readStoredCaseDocument } from '../documentService';
import { assignAttachmentFileNames, readyDateFromPackageFileName } from '@/domain/crematory/crematoryPackage';
import { CrematorySettingsError, normalizeRecipients } from '@/domain/crematory/crematorySettings';
import { sendOutlookMessage, OutlookMailError } from '@/lib/microsoft/outlookMail';
import { getCrematoryMailboxAccess, CrematoryMailboxError } from './crematoryMailboxService';
import { applyCrematoryRecord, assertSendToCrematoryEnabled, CrematoryError, loadForSending } from './crematoryPackageService';

/**
 * Send to Crematory (2026-10). ONE Outlook email, from the organization's
 * connected mailbox, carrying ONE Crematory Package PDF per selected
 * decedent — never merged across decedents, never the permit or page 3 as
 * separate files. Only ever on an explicit staff request; nothing is sent
 * because a permit was uploaded or a package was built.
 *
 * Safeguards, all checked on the server whatever the page showed:
 *   - every selected case must be ready (permit uploaded and confirmed,
 *     page 3 extracted, workflow complete, ready date confirmed, package
 *     current) — otherwise nothing is sent and each problem is named;
 *   - each package's stored bytes must still match its recorded checksum;
 *   - the same request (submissionId) is never sent twice;
 *   - a case is sent ONCE: after a successful send it can never be sent
 *     again; a send Outlook left unclear ("may have been sent") is retried
 *     only after staff check Sent Items and confirm it did not go out;
 *   - a case already being sent refuses a second, simultaneous send.
 *
 * Outcomes are recorded on every case: "submitted" means Outlook accepted
 * the email — not that the crematory received it.
 */
export type SendRequest = {
  caseIds: string[];
  to: unknown;
  cc: unknown;
  subject: string;
  message: string;
  submissionId: string;
  confirmResend: boolean;
};

export type SentAttachment = { caseId: string; caseNumber: string; decedentDisplayName: string; attachmentName: string; packageDocumentId: string; packageVersion: number | null };
export type SendResult = { status: 'submitted'; duplicate: boolean; mailbox: string; internetMessageId: string | null; to: string[]; cc: string[]; attachments: SentAttachment[] };

const MAX_CASES = 20;
const PENDING_STALE_MS = 10 * 60 * 1000;
const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');

async function audit(ctx: ActivityContext, caseId: string, eventType: Parameters<typeof recordCrematoryEvent>[2], details: Parameters<typeof recordCrematoryEvent>[3], mode: DataAdapterMode) {
  try {
    await recordCrematoryEvent(ctx, caseId, eventType, details, mode);
  } catch (error) {
    console.error(`Failed to record ${eventType}:`, error instanceof Error ? error.message : error);
  }
}

export async function sendCrematoryPackages(ctx: ActivityContext, request: SendRequest, mode: DataAdapterMode): Promise<SendResult> {
  assertSendToCrematoryEnabled(ctx.organizationId);

  const caseIds = [...new Set(request.caseIds)];
  if (caseIds.length === 0) throw new CrematoryError('Select at least one case.', 400);
  if (caseIds.length > MAX_CASES) throw new CrematoryError(`Send at most ${MAX_CASES} cases in one email.`, 400);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(request.submissionId)) throw new CrematoryError('A valid submission id is required.', 400);
  const subject = request.subject.trim();
  if (!subject || subject.length > 255) throw new CrematoryError('Enter a subject (up to 255 characters).', 400);
  if (request.message.length > 10000) throw new CrematoryError('The message is too long.', 400);
  let recipients: { to: string[]; cc: string[] };
  try {
    recipients = normalizeRecipients({ to: request.to, cc: request.cc }, { requireTo: true });
  } catch (error) {
    if (error instanceof CrematorySettingsError) throw new CrematoryError(error.message, 400);
    throw error;
  }

  const loaded = [];
  for (const caseId of caseIds) loaded.push(await loadForSending(ctx.organizationId, caseId, mode));

  // The same request again (a double click, a retried network call): report
  // what was already done, send nothing.
  if (loaded.every((l) => l.case_.crematory?.lastSubmission?.submissionId === request.submissionId && l.case_.crematory.lastSubmission.status === 'submitted')) {
    const first = loaded[0].case_.crematory!.lastSubmission!;
    return {
      status: 'submitted',
      duplicate: true,
      mailbox: first.mailbox ?? '',
      internetMessageId: first.internetMessageId,
      to: first.to,
      cc: first.cc,
      attachments: loaded.map((l) => ({
        caseId: l.case_.id,
        caseNumber: l.case_.caseNumber,
        decedentDisplayName: l.summary.decedentDisplayName,
        attachmentName: l.case_.crematory!.lastSubmission!.attachmentName,
        packageDocumentId: l.case_.crematory!.lastSubmission!.packageDocumentId,
        packageVersion: l.case_.crematory!.lastSubmission!.packageVersion,
      })),
    };
  }

  // Each case is sent to the crematory ONCE. After a successful send it can
  // never be sent again — no override.
  const sent = loaded.filter((l) => l.case_.crematory?.lastSubmission?.status === 'submitted');
  if (sent.length > 0) {
    throw new CrematoryError(
      `Nothing was sent. ${sent.map((l) => `${l.summary.decedentDisplayName} (${l.case_.caseNumber})`).join(', ')} ${sent.length === 1 ? 'was' : 'were'} already sent to the crematory. Each case is sent only once.`,
      409,
    );
  }

  const notReady = loaded.filter((l) => !l.readiness.readyToSend);
  if (notReady.length > 0) {
    const problems = notReady.map((l) => `${l.summary.decedentDisplayName} (${l.case_.caseNumber}): ${l.readiness.requirements.filter((r) => !r.ok).map((r) => r.label).join(', ')}`);
    throw new CrematoryError(`Nothing was sent. These cases are not ready — ${problems.join('; ')}.`, 422);
  }

  const now = Date.now();
  const busy = loaded.filter((l) => {
    const pending = l.case_.crematory?.pendingSubmission;
    return pending && pending.submissionId !== request.submissionId && now - Date.parse(pending.startedAt) < PENDING_STALE_MS;
  });
  if (busy.length > 0) throw new CrematoryError(`Nothing was sent. ${busy.map((l) => l.case_.caseNumber).join(', ')} ${busy.length === 1 ? 'is' : 'are'} being sent right now.`, 409);

  // A send whose outcome Outlook left unclear may be retried only once a
  // staff member has checked Sent Items and confirmed it did NOT go out.
  if (!request.confirmResend) {
    const unclear = loaded.filter((l) => l.case_.crematory?.lastSubmission?.status === 'uncertain');
    if (unclear.length > 0) {
      throw new CrematoryError(
        `Nothing was sent. The last send for ${unclear.map((l) => `${l.summary.decedentDisplayName} (${l.case_.caseNumber})`).join(', ')} may have been sent. Check Sent Items in the mailbox, then confirm it was not sent to try again.`,
        409,
      );
    }
  }

  let mailbox: { accessToken: string; accountEmail: string };
  try {
    mailbox = await getCrematoryMailboxAccess(ctx.organizationId, mode);
  } catch (error) {
    if (error instanceof CrematoryMailboxError) throw new CrematoryError(`Nothing was sent. ${error.message}`, error.status);
    throw error;
  }

  // Every package exactly as stored, checked against its recorded checksum.
  const files = [];
  for (const l of loaded) {
    const stored = await readStoredCaseDocument(ctx.organizationId, l.case_.id, l.facts.package!.id, mode).catch(() => null);
    if (!stored || sha256(stored.buffer) !== l.facts.package!.checksumSha256) {
      throw new CrematoryError(`Nothing was sent. The Crematory Package for ${l.case_.caseNumber} could not be read intact from document storage.`, 503);
    }
    files.push({ l, bytes: new Uint8Array(stored.buffer), fileName: l.facts.package!.fileName, caseNumber: l.case_.caseNumber });
  }
  const named = assignAttachmentFileNames(files);

  const startedAt = new Date().toISOString();
  for (const l of loaded) {
    await applyCrematoryRecord(ctx.organizationId, l.case_.id, () => ({ pendingSubmission: { submissionId: request.submissionId, startedAt, startedBy: ctx.actorIdentityId } }), mode);
  }

  const attachments: SentAttachment[] = named.map((n) => ({
    caseId: n.l.case_.id,
    caseNumber: n.l.case_.caseNumber,
    decedentDisplayName: n.l.summary.decedentDisplayName,
    attachmentName: n.attachmentName,
    packageDocumentId: n.l.facts.package!.id,
    packageVersion: n.l.facts.package!.version,
  }));

  const record = (status: 'submitted' | 'failed' | 'uncertain', internetMessageId: string | null, error: string | null) => async (a: SentAttachment) => {
    await applyCrematoryRecord(
      ctx.organizationId,
      a.caseId,
      () => ({
        pendingSubmission: null,
        lastSubmission: {
          submissionId: request.submissionId,
          status,
          packageDocumentId: a.packageDocumentId,
          packageVersion: a.packageVersion,
          attachmentName: a.attachmentName,
          to: recipients.to,
          cc: recipients.cc,
          mailbox: mailbox.accountEmail,
          internetMessageId,
          error,
          at: new Date().toISOString(),
          by: ctx.actorIdentityId,
        },
      }),
      mode,
    ).catch((e) => console.error(`Failed to record the crematory send on case ${a.caseId}:`, e instanceof Error ? e.message : e));
  };

  try {
    const result = await sendOutlookMessage(mailbox.accessToken, {
      to: recipients.to,
      cc: recipients.cc,
      subject,
      bodyText: request.message,
      attachments: named.map((n) => ({ name: n.attachmentName, contentType: 'application/pdf', bytes: n.bytes })),
    });
    for (const a of attachments) {
      await record('submitted', result.internetMessageId, null)(a);
      await audit(ctx, a.caseId, ACTIVITY_EVENT_TYPES.CREMATORY_PACKAGE_SUBMITTED, {
        resourceId: a.packageDocumentId,
        description: `Crematory Package v${a.packageVersion ?? 1} (${a.attachmentName}) submitted from ${mailbox.accountEmail} to ${recipients.to.join(', ')} — submitted to Outlook, delivery not confirmed`,
        record: {
          submissionId: request.submissionId,
          mailbox: mailbox.accountEmail,
          to: recipients.to,
          cc: recipients.cc,
          subject,
          internetMessageId: result.internetMessageId,
          attachmentName: a.attachmentName,
          packageVersion: a.packageVersion,
          expectedReadyDate: readyDateFromPackageFileName(a.attachmentName),
          casesInEmail: attachments.map((x) => x.caseNumber),
        },
      }, mode);
    }
    return { status: 'submitted', duplicate: false, mailbox: mailbox.accountEmail, internetMessageId: result.internetMessageId, to: recipients.to, cc: recipients.cc, attachments };
  } catch (error) {
    const mayHaveSent = error instanceof OutlookMailError ? error.mayHaveSent : false;
    const reason = error instanceof Error ? error.message : 'Outlook could not send the email.';
    const status = mayHaveSent ? 'uncertain' : 'failed';
    for (const a of attachments) {
      await record(status, null, reason)(a);
      await audit(ctx, a.caseId, ACTIVITY_EVENT_TYPES.CREMATORY_PACKAGE_SEND_FAILED, {
        resourceId: a.packageDocumentId,
        description: mayHaveSent
          ? `Crematory Package v${a.packageVersion ?? 1} send may not have completed: ${reason} Check Sent Items in ${mailbox.accountEmail} before trying again.`
          : `Crematory Package v${a.packageVersion ?? 1} was not sent: ${reason}`,
        record: { submissionId: request.submissionId, status, mailbox: mailbox.accountEmail, to: recipients.to, attachmentName: a.attachmentName, error: reason },
        severity: 'warning',
      }, mode);
    }
    throw new CrematoryError(
      mayHaveSent
        ? `${reason} The email may still have been sent — check Sent Items in ${mailbox.accountEmail} before trying again.`
        : `${reason} Nothing was sent; the packages are saved and you can try again.`,
      502,
    );
  }
}
