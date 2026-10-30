import crypto from 'crypto';
import type { DataAdapterMode } from '@/lib/env';
import type { ActivityContext } from '../activityService';
import { recordCrematoryEvent, recordCrematorySendAcknowledgment } from '../activityService';
import { ACTIVITY_EVENT_TYPES } from '@/types/activityEvent';
import { readStoredCaseDocument } from '../documentService';
import { assignAttachmentFileNames, crematoryEmailSubject, defaultCrematoryMessage, readyDateFromPackageFileName } from '@/domain/crematory/crematoryPackage';
import { CrematorySettingsError, normalizeRecipients } from '@/domain/crematory/crematorySettings';
import { sendOutlookMessage, OutlookMailError } from '@/lib/microsoft/outlookMail';
import { getIdentityById } from '../identityService';
import { getCrematoryMailboxAccess, getCrematoryMailboxStatus, CrematoryMailboxError } from './crematoryMailboxService';
import {
  applyCrematoryRecord,
  assertSendToCrematoryEnabled,
  CrematoryError,
  getOrganizationCrematorySettings,
  loadForSending,
  preparationInProgress,
} from './crematoryPackageService';
import { completeCrematorySentChecklist } from './crematorySentChecklist';
import { loadCaseOnServer } from '../serverCaseLoader';
import { SEND_NEEDS_REVIEW_MESSAGE, sendLockHeld, sendOutcomeNeedingReview } from '@/domain/crematory/sendState';
import type { CrematorySendAttemptDetails } from '@/types/case';

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
 *     again;
 *   - a case already being sent refuses a second, simultaneous send;
 *   - (2026-10, durable duplicate-send protection) before Outlook is
 *     contacted, the attempt — with exactly what is about to be emailed —
 *     is recorded on every case (`outlookContactedAt`). If that cannot be
 *     recorded, Outlook is never contacted. From then on, an attempt whose
 *     outcome is not recorded (the server stopped, or Outlook accepted it
 *     and saving "submitted" failed), and a send Outlook itself left
 *     unclear, block every further send — never expiring, never retried
 *     automatically — until an administrator checks Sent Items and records
 *     whether it was sent (reconcileCrematorySend). Only a lock taken
 *     before Outlook was contacted, when nothing can have gone out,
 *     expires on its own (domain/crematory/sendState.ts);
 *   - (2026-10) the email is sent only as staff reviewed it: the request
 *     carries the review fingerprint (reviewCrematorySend) and the staff
 *     member's explicit acknowledgment. Any change since — a rebuilt
 *     package, a moved date, a new permit — refuses it, nothing sent, so a
 *     stale or unreviewed attachment never goes out. Everything is checked
 *     again once every case is locked for sending (no preparation can
 *     start then, and none may be running). Then ONE acknowledgment record
 *     for the whole email — who, when, the exact recipients, subject, and
 *     every case's exact attachment — is written in a single insert before
 *     anything is sent: if it cannot be written, every case is unlocked and
 *     nothing is sent. Each case links to it (acknowledgmentId).
 *
 * Statuses stay separate: reviewed (the acknowledgment), being sent (the
 * case's lock), then submitted (Outlook accepted it — what SOLIS calls
 * sent; delivery is never confirmed), failed (not sent) or uncertain (may
 * have been sent). An acknowledgment alone never marks a case sent.
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
  /** Accepted for compatibility with older pages; it no longer allows
      anything (2026-10) — an unclear send is resolved by an administrator. */
  confirmResend?: boolean;
  /** From reviewCrematorySend: what staff reviewed (2026-10). */
  reviewFingerprint: string;
  /** Staff pressed Confirm & Send, acknowledging the review. */
  acknowledged: boolean;
};

export type SentAttachment = { caseId: string; caseNumber: string; decedentDisplayName: string; attachmentName: string; packageDocumentId: string; packageVersion: number | null };
/** Workflow 3's two "sent to crematory" items (2026-10): completed on each
    sent case, or — if that save failed — named here so staff see it and can
    retry it without sending again. */
export type SentChecklistResult = { failed: Array<{ caseId: string; caseNumber: string }> };
export type SendResult = {
  status: 'submitted';
  duplicate: boolean;
  mailbox: string;
  internetMessageId: string | null;
  to: string[];
  cc: string[];
  attachments: SentAttachment[];
  checklist: SentChecklistResult;
  /** Outlook accepted the email, but SOLIS could not record that on these
      cases (2026-10). They stay blocked — never sent again — until an
      administrator records the send as sent. */
  unrecorded: Array<{ caseId: string; caseNumber: string }>;
};

const MAX_CASES = 20;
const sha256 = (bytes: Uint8Array | string) => crypto.createHash('sha256').update(bytes).digest('hex');
type Loaded = Awaited<ReturnType<typeof loadForSending>>;

/** Each case's attachment, named as it will be sent (unique per email). */
function attachmentsOf(loaded: readonly Loaded[]) {
  return assignAttachmentFileNames(loaded.map((l) => ({ l, fileName: l.summary.expectedFileName ?? l.facts.package!.fileName, caseNumber: l.case_.caseNumber })));
}

/**
 * What a final review covers (2026-10): for every case, the exact package
 * (document, version, checksum) under its attachment name, the expected
 * ready date, and the permit it was built from. Any change to any of them
 * changes the fingerprint. The recipients, subject and message are the
 * final values in the Confirm & Send request itself — sent exactly as
 * given and recorded with the acknowledgment.
 */
function reviewFingerprintOf(loaded: readonly Loaded[]): string {
  const entries = attachmentsOf(loaded).map((a) =>
    JSON.stringify([
      a.l.case_.id,
      a.l.facts.package?.id ?? null,
      a.l.facts.package?.version ?? null,
      a.l.facts.package?.checksumSha256 ?? null,
      a.attachmentName,
      a.l.case_.crematory?.readyDate?.date ?? null,
      a.l.facts.permit?.id ?? null,
      a.l.facts.permit?.checksumSha256 ?? null,
    ]),
  );
  return `v1:${sha256(entries.sort().join('\n'))}`;
}

function validCaseIds(ids: readonly string[]): string[] {
  const caseIds = [...new Set(ids)];
  if (caseIds.length === 0) throw new CrematoryError('Select at least one case.', 400);
  if (caseIds.length > MAX_CASES) throw new CrematoryError(`Send at most ${MAX_CASES} cases in one email.`, 400);
  return caseIds;
}

/** Refuses — nothing sent — unless every case is ready, not sent, and not being prepared. */
function refuseUnsendable(loaded: readonly Loaded[]) {
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
  const preparing = loaded.filter((l) => preparationInProgress(l.case_));
  if (preparing.length > 0) {
    throw new CrematoryError(`Nothing was sent. ${preparing.map((l) => l.case_.caseNumber).join(', ')} ${preparing.length === 1 ? 'is' : 'are'} still being prepared. Try again in a moment.`, 409);
  }
}

export type CrematoryReviewCase = {
  caseId: string;
  caseNumber: string;
  decedentDisplayName: string;
  /** As in the subject and message ("First Last", from the package name). */
  subjectName: string;
  expectedReadyDate: string;
  readyDateFrom: 'staff' | 'expected_pickup';
  attachmentName: string;
  packageDocumentId: string;
  packageVersion: number | null;
  packageChecksumSha256: string;
  permit: { documentId: string; fileName: string; verifiedBy: string | null; verifiedByName: string | null; verifiedAt: string };
  /** The last send may have gone out — staff check Sent Items first. */
  lastSendUnclear: boolean;
};
export type CrematoryReview = {
  fingerprint: string;
  cases: CrematoryReviewCase[];
  to: string[];
  cc: string[];
  subject: string;
  message: string;
  mailbox: string | null;
};

/**
 * The final review (2026-10): the exact email Confirm & Send would send
 * for these cases — each attachment exactly as stored, the default
 * recipients, subject and message — and the fingerprint the send must
 * carry. Read-only: nothing is prepared, changed or sent. Refused for a
 * case that is not ready, already sent, or still being prepared.
 */
export async function reviewCrematorySend(organizationId: string, requestedCaseIds: readonly string[], mode: DataAdapterMode): Promise<CrematoryReview> {
  const config = assertSendToCrematoryEnabled(organizationId);
  const caseIds = validCaseIds(requestedCaseIds);
  const loaded: Loaded[] = [];
  for (const caseId of caseIds) loaded.push(await loadForSending(organizationId, caseId, mode));
  refuseUnresolvedSends(loaded);
  refuseUnsendable(loaded);

  const verifierIds = [...new Set(loaded.map((l) => l.case_.crematory?.permitVerification?.verifiedBy).filter((id): id is string => Boolean(id)))];
  const verifiers = new Map(await Promise.all(verifierIds.map(async (id) => [id, (await getIdentityById(id, mode).catch(() => null))?.displayName ?? null] as const)));
  const cases: CrematoryReviewCase[] = attachmentsOf(loaded).map(({ l, attachmentName }) => {
    const verification = l.case_.crematory!.permitVerification!;
    return {
      caseId: l.case_.id,
      caseNumber: l.case_.caseNumber,
      decedentDisplayName: l.summary.decedentDisplayName,
      subjectName: l.summary.subjectName,
      expectedReadyDate: l.case_.crematory!.readyDate!.date,
      readyDateFrom: l.case_.crematory!.readyDate!.source ?? 'staff',
      attachmentName,
      packageDocumentId: l.facts.package!.id,
      packageVersion: l.facts.package!.version,
      packageChecksumSha256: l.facts.package!.checksumSha256,
      permit: {
        documentId: l.facts.permit!.id,
        fileName: l.facts.permit!.fileName,
        verifiedBy: verification.verifiedBy,
        verifiedByName: verification.verifiedBy ? (verifiers.get(verification.verifiedBy) ?? null) : null,
        verifiedAt: verification.verifiedAt,
      },
      lastSendUnclear: l.case_.crematory?.lastSubmission?.status === 'uncertain',
    };
  });
  const [settings, mailbox] = await Promise.all([getOrganizationCrematorySettings(organizationId, mode), getCrematoryMailboxStatus(organizationId, mode)]);
  const organizationName = config.emailOrganizationName;
  return {
    fingerprint: reviewFingerprintOf(loaded),
    cases,
    to: settings.to,
    cc: settings.cc,
    subject: crematoryEmailSubject(organizationName, cases.map((c) => ({ decedentDisplayName: c.subjectName, expectedReadyDate: c.expectedReadyDate }))),
    message: defaultCrematoryMessage(organizationName, cases.map((c) => ({ decedentDisplayName: c.subjectName, expectedReadyDate: c.expectedReadyDate, attachmentName: c.attachmentName }))),
    mailbox: mailbox.connected ? mailbox.accountEmail : null,
  };
}

/**
 * After a confirmed send: completes each case's two "sent to crematory"
 * checklist items (crematorySentChecklist.ts). Never throws — the email is
 * already sent and recorded; a case whose checklist could not be saved is
 * reported (and logged) so staff can retry it, and nothing is ever re-sent
 * for it.
 */
async function completeSentChecklists(ctx: ActivityContext, sent: ReadonlyArray<{ caseId: string; caseNumber: string }>, submissionId: string, mode: DataAdapterMode): Promise<SentChecklistResult> {
  const failed: SentChecklistResult['failed'] = [];
  for (const c of sent) {
    try {
      await completeCrematorySentChecklist(ctx, c.caseId, submissionId, mode);
    } catch (error) {
      console.error(`The crematory email was sent, but the checklist for case ${c.caseId} could not be saved:`, error instanceof Error ? error.message : error);
      failed.push(c);
    }
  }
  return { failed };
}

async function audit(ctx: ActivityContext, caseId: string, eventType: Parameters<typeof recordCrematoryEvent>[2], details: Parameters<typeof recordCrematoryEvent>[3], mode: DataAdapterMode) {
  try {
    await recordCrematoryEvent(ctx, caseId, eventType, details, mode);
  } catch (error) {
    console.error(`Failed to record ${eventType}:`, error instanceof Error ? error.message : error);
  }
}

export async function sendCrematoryPackages(ctx: ActivityContext, request: SendRequest, mode: DataAdapterMode): Promise<SendResult> {
  assertSendToCrematoryEnabled(ctx.organizationId);

  const caseIds = validCaseIds(request.caseIds);
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

  // A page opened before the final review existed carries no fingerprint.
  if (typeof request.reviewFingerprint !== 'string' || !request.reviewFingerprint.startsWith('v1:')) {
    throw new CrematoryError('Nothing was sent. Send to Crematory was updated — close this window, open it again and review the email.', 409);
  }
  if (request.acknowledged !== true) throw new CrematoryError('Nothing was sent. Review the recipients, subject, message and attachments, then press Confirm & Send.', 400);

  const loaded: Loaded[] = [];
  for (const caseId of caseIds) loaded.push(await loadForSending(ctx.organizationId, caseId, mode));

  // The same request again (a double click, a retried network call): report
  // what was already done, send nothing.
  if (loaded.every((l) => l.case_.crematory?.lastSubmission?.submissionId === request.submissionId && l.case_.crematory.lastSubmission.status === 'submitted')) {
    const first = loaded[0].case_.crematory!.lastSubmission!;
    // A checklist that could not be saved the first time is completed now —
    // idempotent, and nothing is sent.
    const checklist = await completeSentChecklists(ctx, loaded.map((l) => ({ caseId: l.case_.id, caseNumber: l.case_.caseNumber })), request.submissionId, mode);
    return {
      checklist,
      unrecorded: [],
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

  // A send that may have reached the crematory and whose outcome SOLIS could
  // not confirm blocks every further send until an administrator resolves
  // it (2026-10) — whatever this request says, however long ago it was.
  refuseUnresolvedSends(loaded);

  // Each case is sent to the crematory ONCE. After a successful send it can
  // never be sent again — no override. And only when ready, not being prepared.
  refuseUnsendable(loaded);
  const STALE_REVIEW = 'Nothing was sent. A Crematory Package, date or permit changed since you reviewed the email. Review it again.';
  if (reviewFingerprintOf(loaded) !== request.reviewFingerprint) throw new CrematoryError(STALE_REVIEW, 409);

  // A send already in progress — by another staff member, or this same
  // request arriving twice (a double click, a retried call) — is never
  // joined: only one request ever holds the case and sends (2026-10).
  const now = Date.now();
  const busy = loaded.filter((l) => sendLockHeld(l.case_.crematory, now));
  if (busy.length > 0) throw new CrematoryError(`Nothing was sent. ${busy.map((l) => l.case_.caseNumber).join(', ')} ${busy.length === 1 ? 'is' : 'are'} being sent right now.`, 409);

  let mailbox: { accessToken: string; accountEmail: string };
  try {
    mailbox = await getCrematoryMailboxAccess(ctx.organizationId, mode);
  } catch (error) {
    if (error instanceof CrematoryMailboxError) throw new CrematoryError(`Nothing was sent. ${error.message}`, error.status);
    throw error;
  }

  // Lock every case for this send — atomically, only while no preparation
  // is running and no other send holds it — so nothing can rebuild a
  // package from here on.
  const startedAt = new Date().toISOString();
  const acknowledgmentId = crypto.randomUUID();
  const locked: string[] = [];
  const unlock = async () => {
    for (const caseId of locked) {
      await applyCrematoryRecord(ctx.organizationId, caseId, (c) => (c.crematory?.pendingSubmission?.submissionId === request.submissionId ? { pendingSubmission: null } : null), mode).catch((e) =>
        console.error(`Failed to release the crematory send lock on case ${caseId}:`, e instanceof Error ? e.message : e),
      );
    }
  };
  try {
    for (const l of loaded) {
      await applyCrematoryRecord(
        ctx.organizationId,
        l.case_.id,
        (current) => {
          const record = current.crematory;
          if (record?.lastSubmission?.status === 'submitted') throw new CrematoryError(`Nothing was sent. ${current.caseNumber} was already sent to the crematory.`, 409);
          if (sendOutcomeNeedingReview(record)) throw new CrematoryError(`Nothing was sent. ${current.caseNumber}: ${SEND_NEEDS_REVIEW_MESSAGE}`, 409);
          if (sendLockHeld(record)) throw new CrematoryError(`Nothing was sent. ${current.caseNumber} is being sent right now.`, 409);
          if (preparationInProgress(current)) throw new CrematoryError(`Nothing was sent. ${current.caseNumber} is still being prepared. Try again in a moment.`, 409);
          return { pendingSubmission: { submissionId: request.submissionId, startedAt, startedBy: ctx.actorIdentityId, acknowledgmentId } };
        },
        mode,
      );
      locked.push(l.case_.id);
    }
  } catch (error) {
    await unlock();
    throw error;
  }

  // Everything again, now that nothing can change: still ready, still
  // exactly what was reviewed, every package intact in storage.
  type File = { l: Loaded; bytes: Uint8Array; fileName: string; caseNumber: string };
  let named: Array<File & { attachmentName: string }>;
  try {
    const current: Loaded[] = [];
    for (const caseId of caseIds) current.push(await loadForSending(ctx.organizationId, caseId, mode));
    const notReady = current.filter((l) => !l.readiness.readyToSend);
    if (notReady.length > 0) throw new CrematoryError(`Nothing was sent. ${notReady.map((l) => l.case_.caseNumber).join(', ')} changed and ${notReady.length === 1 ? 'is' : 'are'} no longer ready. Review it again.`, 409);
    if (reviewFingerprintOf(current) !== request.reviewFingerprint) throw new CrematoryError(STALE_REVIEW, 409);
    const files: File[] = [];
    for (const l of current) {
      const stored = await readStoredCaseDocument(ctx.organizationId, l.case_.id, l.facts.package!.id, mode).catch(() => null);
      if (!stored || sha256(stored.buffer) !== l.facts.package!.checksumSha256) {
        throw new CrematoryError(`Nothing was sent. The Crematory Package for ${l.case_.caseNumber} could not be read intact from document storage.`, 503);
      }
      // Attached under the current naming (a package built before 2026-10
      // keeps its stored name; its bytes are sent unchanged).
      files.push({ l, bytes: new Uint8Array(stored.buffer), fileName: l.summary.expectedFileName ?? l.facts.package!.fileName, caseNumber: l.case_.caseNumber });
    }
    named = assignAttachmentFileNames(files);
  } catch (error) {
    await unlock();
    throw error;
  }

  const attachments: SentAttachment[] = named.map((n) => ({
    caseId: n.l.case_.id,
    caseNumber: n.l.case_.caseNumber,
    decedentDisplayName: n.l.summary.decedentDisplayName,
    attachmentName: n.attachmentName,
    packageDocumentId: n.l.facts.package!.id,
    packageVersion: n.l.facts.package!.version,
  }));
  const checksumOf = new Map(named.map((n) => [n.l.case_.id, n.l.facts.package!.checksumSha256]));

  // The acknowledgment: one record for the whole email, before anything is sent.
  const acknowledgedAt = new Date().toISOString();
  try {
    await recordCrematorySendAcknowledgment(ctx, {
      submissionId: request.submissionId,
      description: `Final review confirmed (Confirm & Send): ${attachments.length === 1 ? '1 attachment' : `${attachments.length} attachments`} (${attachments.map((a) => a.caseNumber).join(', ')}) to ${recipients.to.join(', ')} — "${subject}"`,
      record: {
        acknowledgmentId,
        submissionId: request.submissionId,
        reviewFingerprint: request.reviewFingerprint,
        acknowledgedBy: ctx.actorIdentityId,
        acknowledgedAt,
        mailbox: mailbox.accountEmail,
        to: recipients.to,
        cc: recipients.cc,
        subject,
        messageSha256: sha256(request.message),
        caseIds: attachments.map((a) => a.caseId),
        attachments: attachments.map((a) => ({ caseId: a.caseId, caseNumber: a.caseNumber, attachmentName: a.attachmentName, packageDocumentId: a.packageDocumentId, packageVersion: a.packageVersion, packageChecksumSha256: checksumOf.get(a.caseId) })),
      },
    }, mode);
  } catch (error) {
    console.error('Failed to record the crematory send acknowledgment:', error instanceof Error ? error.message : error);
    await unlock();
    throw new CrematoryError('Nothing was sent. Your confirmation could not be recorded. Please try again.', 503);
  }

  /** Records the outcome on one case and releases its attempt. False when it
      could not be saved — the attempt then stays, blocking the case until
      an administrator resolves it (never sent again automatically). */
  const record = (status: 'submitted' | 'failed' | 'uncertain', internetMessageId: string | null, error: string | null) => async (a: SentAttachment): Promise<boolean> => {
    return applyCrematoryRecord(
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
          packageChecksumSha256: checksumOf.get(a.caseId) ?? null,
          subject,
          reviewFingerprint: request.reviewFingerprint,
          acknowledgmentId,
        },
      }),
      mode,
    ).then(
      () => true,
      (e) => {
        console.error(`Failed to record the crematory send on case ${a.caseId}:`, e instanceof Error ? e.message : e);
        return false;
      },
    );
  };

  // The durable send attempt (2026-10): on every case, exactly what is about
  // to be emailed, recorded BEFORE Outlook is contacted. If it cannot be
  // recorded on every case, Outlook is never contacted and nothing is sent.
  // Once recorded, the attempt never expires: until its outcome is recorded
  // or an administrator resolves it, no case in it can be sent again.
  const outlookContactedAt = new Date().toISOString();
  try {
    for (const a of attachments) {
      const attempt: CrematorySendAttemptDetails = {
        packageDocumentId: a.packageDocumentId,
        packageVersion: a.packageVersion,
        attachmentName: a.attachmentName,
        packageChecksumSha256: checksumOf.get(a.caseId) ?? null,
        to: recipients.to,
        cc: recipients.cc,
        mailbox: mailbox.accountEmail,
        subject,
        reviewFingerprint: request.reviewFingerprint,
      };
      await applyCrematoryRecord(
        ctx.organizationId,
        a.caseId,
        (current) => {
          const pending = current.crematory?.pendingSubmission;
          if (pending?.submissionId !== request.submissionId) throw new CrematoryError(`Nothing was sent. ${current.caseNumber} is no longer held for this send. Review it again.`, 409);
          return { pendingSubmission: { ...pending, outlookContactedAt, attempt } };
        },
        mode,
      );
    }
  } catch (error) {
    console.error('Failed to record the crematory send attempt:', error instanceof Error ? error.message : error);
    await unlock();
    throw error instanceof CrematoryError ? error : new CrematoryError('Nothing was sent. The send could not be recorded before contacting Outlook. Please try again.', 503);
  }

  let result: Awaited<ReturnType<typeof sendOutlookMessage>>;
  try {
    result = await sendOutlookMessage(mailbox.accessToken, {
      to: recipients.to,
      cc: recipients.cc,
      subject,
      bodyText: request.message,
      attachments: named.map((n) => ({ name: n.attachmentName, contentType: 'application/pdf', bytes: n.bytes })),
    });
  } catch (error) {
    const mayHaveSent = error instanceof OutlookMailError ? error.mayHaveSent : false;
    const reason = error instanceof Error ? error.message : 'Outlook could not send the email.';
    const status = mayHaveSent ? 'uncertain' : 'failed';
    let allRecorded = true;
    for (const a of attachments) {
      // Not recorded: the attempt stays, and the case stays blocked until an
      // administrator resolves it — never released on a guess.
      if (!(await record(status, null, reason)(a))) allRecorded = false;
      await audit(ctx, a.caseId, ACTIVITY_EVENT_TYPES.CREMATORY_PACKAGE_SEND_FAILED, {
        resourceId: a.packageDocumentId,
        description: mayHaveSent
          ? `Crematory Package v${a.packageVersion ?? 1} send may not have completed: ${reason} An administrator must check Sent Items in ${mailbox.accountEmail} and record whether it was sent.`
          : `Crematory Package v${a.packageVersion ?? 1} was not sent: ${reason}`,
        record: { submissionId: request.submissionId, status, mailbox: mailbox.accountEmail, to: recipients.to, attachmentName: a.attachmentName, error: reason, acknowledgmentId },
        severity: 'warning',
      }, mode);
    }
    throw new CrematoryError(
      mayHaveSent || !allRecorded
        ? `${reason} The email may still have been sent. It will not be sent again until an administrator checks Sent Items in ${mailbox.accountEmail} and records whether it was sent.`
        : `${reason} Nothing was sent; the packages are saved and you can try again.`,
      502,
    );
  }

  // Outlook accepted the email. Nothing below can turn that into a resend.
  const unrecorded: SendResult['unrecorded'] = [];
  for (const a of attachments) {
    const saved = await record('submitted', result.internetMessageId, null)(a);
    if (!saved) unrecorded.push({ caseId: a.caseId, caseNumber: a.caseNumber });
    await audit(ctx, a.caseId, ACTIVITY_EVENT_TYPES.CREMATORY_PACKAGE_SUBMITTED, {
      resourceId: a.packageDocumentId,
      description: `Crematory Package v${a.packageVersion ?? 1} (${a.attachmentName}) submitted from ${mailbox.accountEmail} to ${recipients.to.join(', ')} — submitted to Outlook, delivery not confirmed${saved ? '' : '. SOLIS could not save this on the case; it stays blocked until an administrator records it as sent'}`,
      record: {
        submissionId: request.submissionId,
        mailbox: mailbox.accountEmail,
        to: recipients.to,
        cc: recipients.cc,
        subject,
        internetMessageId: result.internetMessageId,
        attachmentName: a.attachmentName,
        packageVersion: a.packageVersion,
        packageChecksumSha256: checksumOf.get(a.caseId) ?? null,
        reviewFingerprint: request.reviewFingerprint,
        acknowledgmentId,
        acknowledgedBy: ctx.actorIdentityId,
        expectedReadyDate: readyDateFromPackageFileName(a.attachmentName),
        casesInEmail: attachments.map((x) => x.caseNumber),
        sendRecordSaved: saved,
      },
      ...(saved ? {} : { severity: 'warning' as const }),
    }, mode);
  }
  // Workflow 3's "sent to crematory" items, on every case whose send is recorded.
  const recorded = attachments.filter((a) => !unrecorded.some((u) => u.caseId === a.caseId));
  const checklist = await completeSentChecklists(ctx, recorded, request.submissionId, mode);
  return { status: 'submitted', duplicate: false, mailbox: mailbox.accountEmail, internetMessageId: result.internetMessageId, to: recipients.to, cc: recipients.cc, attachments, checklist, unrecorded };
}

function refuseUnresolvedSends(loaded: readonly Loaded[]) {
  const unresolved = loaded.filter((l) => sendOutcomeNeedingReview(l.case_.crematory));
  if (unresolved.length > 0) {
    throw new CrematoryError(`Nothing was sent. ${unresolved.map((l) => `${l.summary.decedentDisplayName} (${l.case_.caseNumber})`).join(', ')}: ${SEND_NEEDS_REVIEW_MESSAGE}`, 409);
  }
}

export type ReconcileSendRequest = { decision: unknown; reason: unknown };
export type ReconcileSendResult = { decision: 'sent' | 'not_sent'; checklist: SentChecklistResult };

/**
 * An administrator resolves a send SOLIS could not confirm (2026-10) —
 * Outlook said it may have been sent ("uncertain"), or the attempt reached
 * Outlook and its result was never recorded ("unrecorded") — after checking
 * Sent Items in the mailbox:
 *   - 'sent': the case is recorded as sent (permanently, as any send), and
 *     Workflow 3's two "sent to crematory" items are completed from it;
 *   - 'not_sent': the attempt is recorded as not sent, and the case can be
 *     sent again — only ever by a new, explicit Confirm & Send.
 * A reason is required. The attempt's details, the earlier status, the
 * decision, who and when are kept on the send record and in activity.
 * Nothing is sent here. Refused for an archived case and for a case with
 * nothing to resolve.
 */
export async function reconcileCrematorySend(ctx: ActivityContext, caseId: string, request: ReconcileSendRequest, mode: DataAdapterMode): Promise<ReconcileSendResult> {
  assertSendToCrematoryEnabled(ctx.organizationId);
  if (request.decision !== 'sent' && request.decision !== 'not_sent') throw new CrematoryError("decision must be 'sent' or 'not_sent'.", 400);
  const decision = request.decision;
  const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
  if (reason.length < 3 || reason.length > 1000) throw new CrematoryError('Say how you checked (for example, what Sent Items shows).', 400);

  const at = new Date().toISOString();
  let resolved: { submissionId: string; previousStatus: 'uncertain' | 'unrecorded'; packageDocumentId: string; attachmentName: string } | null = null;
  await applyCrematoryRecord(
    ctx.organizationId,
    caseId,
    (current) => {
      if (current.isDeleted) throw new CrematoryError('This case is archived and read-only.', 409);
      const record = current.crematory;
      const review = sendOutcomeNeedingReview(record);
      if (!review) throw new CrematoryError('This case has no send waiting to be resolved.', 409);
      const pending = record?.pendingSubmission;
      const last = record?.lastSubmission;
      // What the attempt emailed: from the durable attempt, or the unclear send record.
      const base =
        review.reason === 'unrecorded' && pending?.attempt
          ? {
              packageDocumentId: pending.attempt.packageDocumentId,
              packageVersion: pending.attempt.packageVersion,
              attachmentName: pending.attempt.attachmentName,
              to: pending.attempt.to,
              cc: pending.attempt.cc,
              mailbox: pending.attempt.mailbox,
              internetMessageId: null,
              packageChecksumSha256: pending.attempt.packageChecksumSha256,
              subject: pending.attempt.subject,
              reviewFingerprint: pending.attempt.reviewFingerprint,
              acknowledgmentId: pending.acknowledgmentId ?? null,
            }
          : {
              packageDocumentId: last?.packageDocumentId ?? '',
              packageVersion: last?.packageVersion ?? null,
              attachmentName: last?.attachmentName ?? '',
              to: last?.to ?? [],
              cc: last?.cc ?? [],
              mailbox: last?.mailbox ?? null,
              internetMessageId: last?.internetMessageId ?? null,
              packageChecksumSha256: last?.packageChecksumSha256 ?? null,
              subject: last?.subject ?? null,
              reviewFingerprint: last?.reviewFingerprint ?? null,
              acknowledgmentId: last?.acknowledgmentId ?? null,
            };
      resolved = { submissionId: review.submissionId, previousStatus: review.reason, packageDocumentId: base.packageDocumentId, attachmentName: base.attachmentName };
      return {
        pendingSubmission: null,
        lastSubmission: {
          ...base,
          submissionId: review.submissionId,
          status: decision === 'sent' ? 'submitted' : 'failed',
          error: decision === 'sent' ? null : 'An administrator confirmed in Sent Items that this email was not sent.',
          // A send recorded as sent keeps when it went out; "not sent" is recorded now.
          at: decision === 'sent' ? review.at : at,
          by: decision === 'sent' ? (pending?.startedBy ?? last?.by ?? null) : ctx.actorIdentityId,
          reconciliation: { previousStatus: review.reason, decision, reason, by: ctx.actorIdentityId, at },
        },
      };
    },
    mode,
  );
  const done = resolved as { submissionId: string; previousStatus: 'uncertain' | 'unrecorded'; packageDocumentId: string; attachmentName: string } | null;
  if (!done) throw new CrematoryError('This case has no send waiting to be resolved.', 409);

  await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_SEND_RECONCILED, {
    resourceId: done.packageDocumentId || null,
    description:
      decision === 'sent'
        ? `An administrator recorded the unconfirmed crematory send (${done.attachmentName || 'Crematory Package'}) as sent: ${reason}`
        : `An administrator recorded the unconfirmed crematory send (${done.attachmentName || 'Crematory Package'}) as not sent — the case can be sent again: ${reason}`,
    record: { submissionId: done.submissionId, previousStatus: done.previousStatus, decision, reason },
    severity: 'warning',
  }, mode);

  const case_ = decision === 'sent' ? await loadCaseOnServer(ctx.organizationId, caseId, mode).catch(() => null) : null;
  const checklist = decision === 'sent' ? await completeSentChecklists(ctx, [{ caseId, caseNumber: case_?.caseNumber ?? caseId }], done.submissionId, mode) : { failed: [] };
  return { decision, checklist };
}
