import crypto from 'crypto';
import type { DataAdapterMode } from '@/lib/env';
import { ACTIVITY_EVENT_TYPES } from '@/types/activityEvent';
import { recordFaxTestEvent, type ActivityContext } from '../activityService';
import { canManageOrganization, canSendFax } from '../authorizationPolicyService';
import { getCrematoryMailboxAccess, getCrematoryMailboxStatus, CrematoryMailboxError } from '../crematory/crematoryMailboxService';
import { sendOutlookMessage, OutlookMailError } from '@/lib/microsoft/outlookMail';
import { deathCertificateFaxSettings, type DeathCertificateFaxSettings } from '@/domain/faxBundles/faxSettings';
import {
  EMAIL_DRY_RUN_CHECKS,
  FAX_TEST_FINAL,
  FAX_TEST_STATUS_LABEL,
  FAX_TEST_STEPS,
  faxTestAttachmentName,
  faxTestRecipients,
  isFaxTestStep,
  nextFaxTestStatuses,
  type EmailDryRunCheck,
  type FaxTestRecipient,
  type FaxTestStatus,
  type FaxTestStep,
} from '@/domain/faxBundles/faxTest';
import { FaxSettingsServiceError, renderBundleEmail, resolveFaxConfiguration } from '../faxSettings/faxSettingsService';
import { buildFaxTestPdf } from './faxTestPdf';
import {
  acquireFaxTestLock,
  faxTestId,
  getFaxTest,
  getFaxTestLock,
  insertFaxTest,
  listFaxTests,
  releaseFaxTestLock,
  updateFaxTestIf,
  type FaxTestTransmission,
} from './faxTestStore';

/**
 * Fax test transmissions (2026-11) — docs/FAX_TEST_TRANSMISSIONS.md.
 *
 * Sends a FICTIONAL test PDF through the same path Send Fax uses (the
 * connected Outlook mailbox → Microsoft Graph → an empty plain-text body
 * and ONE PDF) to a recipient on the organization's code-only allowlist.
 * Real fax bundles are untouched and stay blocked by `sendingEnabled`; this
 * module never reads or writes a bundle, case or checklist.
 *
 * Safeguards, in order, for each transmission:
 *   - an Administrator (organization.manage) who may also fax (fax.send);
 *   - the recipient is on the allowlist (the browser names it by key only);
 *   - the step is unlocked (0 → 1 → 2, each only after the previous passed);
 *   - the request repeats the recipient and page count it was confirmed for;
 *   - the submission id is unique and recorded (a repeat sends nothing);
 *   - one open test per organization (an atomic lock row): nothing else is
 *     sent until an administrator records how the open one ended;
 *   - the record and an audit event are written BEFORE Outlook is contacted;
 *   - one Graph send; never retried. A result that is not known is
 *     "needs review" and keeps everything blocked.
 * Outlook submission, NuSo acceptance and delivery are recorded separately.
 */

export class FaxTestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FaxTestError';
  }
}

const describe = (t: Pick<FaxTestTransmission, 'step' | 'kind' | 'pages' | 'recipientDisplay'>) =>
  `${t.kind === 'fax' ? `${t.pages}-page fax test` : 'Email dry run'} (step ${t.step}) to ${t.recipientDisplay}`;

function settingsOf(organizationId: string): DeathCertificateFaxSettings {
  const settings = deathCertificateFaxSettings(organizationId);
  if (!settings) throw new FaxTestError('Faxing is not set up for this organization.', 404);
  return settings;
}

async function authorize(ctx: ActivityContext, mode: DataAdapterMode): Promise<void> {
  settingsOf(ctx.organizationId);
  const params = ctx.actorIdentityId && ctx.actorRoleKey ? { identityId: ctx.actorIdentityId, organizationId: ctx.organizationId, roleKey: ctx.actorRoleKey } : null;
  const allowed = params ? (await canManageOrganization(params, mode)) && (await canSendFax(params, mode)) : false;
  if (!allowed) throw new FaxTestError('Only administrators who may fax can run fax tests.', 403);
}

// ---------------------------------------------------------------- overview

export type FaxTestView = FaxTestTransmission & { statusLabel: string; next: FaxTestStatus[]; open: boolean };
export type FaxTestStepView = { step: FaxTestStep; label: string; kind: FaxTestRecipient['kind']; pages: 1 | 2; available: boolean; passed: boolean; reason: string | null };
export type FaxTestOverview = {
  /** True only when the allowlist has at least one valid recipient. */
  enabled: boolean;
  /** Real bundles — shown so nobody confuses the two. */
  sendingEnabled: boolean;
  recipients: Array<Pick<FaxTestRecipient, 'key' | 'kind' | 'display'>>;
  invalidRecipients: number;
  mailbox: { connected: boolean; accountEmail: string | null };
  steps: FaxTestStepView[];
  /** The test holding the organization's lock, if any. */
  openTransmissionId: string | null;
  transmissions: FaxTestView[];
  expectedChecksums: Record<1 | 2, string>;
  dryRunChecks: Array<{ key: EmailDryRunCheck; label: string }>;
};

const view = (t: FaxTestTransmission, openId: string | null): FaxTestView => ({ ...t, statusLabel: FAX_TEST_STATUS_LABEL[t.status], next: nextFaxTestStatuses(t.status, t.kind), open: t.id === openId });
const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');

function stepStates(recipients: FaxTestRecipient[], transmissions: FaxTestTransmission[]): FaxTestStepView[] {
  const passed = (step: FaxTestStep) => transmissions.some((t) => t.step === step && t.status === 'delivered' && t.passed === true);
  return ([0, 1, 2] as FaxTestStep[]).map((step) => {
    const spec = FAX_TEST_STEPS[step];
    const hasRecipient = recipients.some((r) => r.kind === spec.kind);
    let reason: string | null = null;
    if (!hasRecipient) reason = spec.kind === 'fax' ? 'No approved test fax number is configured.' : 'No approved dry-run email address is configured.';
    else if (step > 0 && !passed((step - 1) as FaxTestStep)) reason = `Step ${step - 1} must pass first.`;
    return { step, label: spec.label, kind: spec.kind, pages: spec.pages, available: reason === null, passed: passed(step), reason };
  });
}

export async function getFaxTestOverview(ctx: ActivityContext, mode: DataAdapterMode): Promise<FaxTestOverview> {
  await authorize(ctx, mode);
  const settings = settingsOf(ctx.organizationId);
  const { recipients, invalid } = faxTestRecipients(settings);
  const [transmissions, lock, mailbox] = await Promise.all([
    listFaxTests(ctx.organizationId, mode),
    getFaxTestLock(ctx.organizationId, mode),
    getCrematoryMailboxStatus(ctx.organizationId, mode).catch(() => ({ connected: false as const })),
  ]);
  const [one, two] = await Promise.all([buildFaxTestPdf(1), buildFaxTestPdf(2)]);
  return {
    enabled: recipients.length > 0,
    sendingEnabled: settings.sendingEnabled,
    recipients: recipients.map(({ key, kind, display }) => ({ key, kind, display })),
    invalidRecipients: invalid.length,
    mailbox: mailbox.connected ? { connected: true, accountEmail: mailbox.accountEmail } : { connected: false, accountEmail: null },
    steps: stepStates(recipients, transmissions),
    openTransmissionId: lock?.transmissionId ?? null,
    transmissions: transmissions.map((t) => view(t, lock?.transmissionId ?? null)),
    expectedChecksums: { 1: sha256(one), 2: sha256(two) },
    dryRunChecks: (Object.keys(EMAIL_DRY_RUN_CHECKS) as EmailDryRunCheck[]).map((key) => ({ key, label: EMAIL_DRY_RUN_CHECKS[key] })),
  };
}

// ---------------------------------------------------------------- send

export type FaxTestSendInput = { step?: unknown; recipientKey?: unknown; submissionId?: unknown; confirm?: unknown };
export type FaxTestSendResult = { duplicate: boolean; transmission: FaxTestView };

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const testReference = () => `TEST-${Array.from(crypto.randomBytes(6), (b) => REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]).join('')}`;

async function audit(ctx: ActivityContext, eventType: Parameters<typeof recordFaxTestEvent>[1], t: FaxTestTransmission, description: string, extra: Record<string, unknown> = {}, severity: 'info' | 'warning' = 'info', mode: DataAdapterMode) {
  return recordFaxTestEvent(
    ctx,
    eventType,
    {
      transmissionId: t.id,
      description,
      record: { submissionId: t.submissionId, step: t.step, kind: t.kind, pages: t.pages, recipient: t.recipientAddress, subject: t.subject, attachmentName: t.attachmentName, pdfChecksumSha256: t.pdfChecksumSha256, sender: t.senderAddress, ...extra },
      severity,
    },
    mode,
  );
}

/**
 * Sends ONE fictional test PDF. Throws FaxTestError (nothing sent) for every
 * refusal; returns the transmission otherwise — including when this exact
 * submission was already made (duplicate: true, nothing sent again).
 */
export async function sendFaxTest(ctx: ActivityContext, rawInput: unknown, mode: DataAdapterMode): Promise<FaxTestSendResult> {
  await authorize(ctx, mode);
  const settings = settingsOf(ctx.organizationId);
  const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as FaxTestSendInput;

  if (typeof input.submissionId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(input.submissionId)) throw new FaxTestError('A valid submission id is required. Nothing was sent.', 400);
  const submissionId = input.submissionId;
  const id = faxTestId(ctx.organizationId, submissionId);

  // The same request again: report it, never send it again.
  const existing = await getFaxTest(ctx.organizationId, id, mode);
  if (existing) return { duplicate: true, transmission: view(existing, (await getFaxTestLock(ctx.organizationId, mode))?.transmissionId ?? null) };

  const { recipients } = faxTestRecipients(settings);
  if (recipients.length === 0) throw new FaxTestError('Test transmissions are off: no approved test recipients are configured. Nothing was sent.', 409);
  if (!isFaxTestStep(input.step)) throw new FaxTestError('Choose test step 0, 1 or 2. Nothing was sent.', 400);
  const step = input.step;
  const spec = FAX_TEST_STEPS[step];
  const recipient = recipients.find((r) => r.key === input.recipientKey);
  if (!recipient) throw new FaxTestError('That recipient is not on the approved test list. Nothing was sent.', 400);
  if (recipient.kind !== spec.kind) throw new FaxTestError(`Step ${step} needs ${spec.kind === 'fax' ? 'an approved test fax number' : 'an approved dry-run email address'}. Nothing was sent.`, 400);

  // Explicit confirmation of exactly what is about to be sent.
  const confirm = (input.confirm && typeof input.confirm === 'object' ? input.confirm : {}) as Record<string, unknown>;
  if (confirm.acknowledged !== true || confirm.recipient !== recipient.display || confirm.pages !== spec.pages) {
    throw new FaxTestError(`Confirm the test first: a ${spec.pages}-page fictional PDF to ${recipient.display}. Nothing was sent.`, 400);
  }

  const states = stepStates(recipients, await listFaxTests(ctx.organizationId, mode));
  const state = states[step];
  if (!state.available) throw new FaxTestError(`${state.reason} Nothing was sent.`, 409);

  // Same subject and body Send Fax would use (a TEST- reference); the body is empty unless the provider is verified for one.
  let email: { subject: string; body: string };
  try {
    const config = await resolveFaxConfiguration(ctx.organizationId, mode);
    email = renderBundleEmail(config, { reference: testReference(), applicationCount: 1, pageCount: spec.pages });
  } catch (error) {
    if (error instanceof FaxSettingsServiceError) throw new FaxTestError(`${error.message} Nothing was sent.`, error.status === 404 ? 404 : 409);
    throw error;
  }
  const pdf = await buildFaxTestPdf(spec.pages);

  let mailbox: { accessToken: string; accountEmail: string };
  try {
    mailbox = await getCrematoryMailboxAccess(ctx.organizationId, mode);
  } catch (error) {
    if (error instanceof CrematoryMailboxError) throw new FaxTestError(`Nothing was sent. ${error.message}`, error.status);
    throw error;
  }

  // One open test per organization — atomic: Wix refuses a second insert of the lock row.
  let lock: Awaited<ReturnType<typeof acquireFaxTestLock>>;
  try {
    lock = await acquireFaxTestLock(ctx.organizationId, id, mode);
  } catch (error) {
    // e.g. the collection does not exist yet (migration not run): nothing can be recorded, so nothing is sent.
    console.error('Fax test: could not take the test lock:', error instanceof Error ? error.message : error);
    throw new FaxTestError('Nothing was sent. The test could not be recorded before contacting Outlook. Please try again.', 503);
  }
  if (!lock.acquired) {
    if (lock.holder?.transmissionId === id) {
      const same = await getFaxTest(ctx.organizationId, id, mode);
      if (same) return { duplicate: true, transmission: view(same, id) };
      throw new FaxTestError('This test is already being sent. Nothing more was sent.', 409);
    }
    throw new FaxTestError('Another test transmission is open. Record how it ended before sending the next one. Nothing was sent.', 409);
  }

  // The durable attempt: recorded BEFORE Outlook is contacted, or nothing is sent.
  const now = new Date().toISOString();
  const record: FaxTestTransmission = {
    id,
    organizationId: ctx.organizationId,
    submissionId,
    step,
    kind: spec.kind,
    pages: spec.pages,
    recipientKey: recipient.key,
    recipientAddress: recipient.address,
    recipientDisplay: recipient.display,
    senderAddress: mailbox.accountEmail,
    subject: email.subject,
    attachmentName: faxTestAttachmentName(spec.pages),
    pdfChecksumSha256: sha256(pdf),
    pdfSizeBytes: pdf.byteLength,
    status: 'contacting',
    revision: 0,
    requestedBy: ctx.actorIdentityId,
    createdAt: now,
    outlookContactedAt: now,
    submittedAt: null,
    outlookDraftId: null,
    internetMessageId: null,
    failureMessage: null,
    nusoAcceptedAt: null,
    nusoReference: null,
    outcomeAt: null,
    pagesReceived: null,
    checks: null,
    passed: null,
    note: null,
    updatedAt: now,
    updatedBy: ctx.actorIdentityId,
    history: [{ at: now, actorId: ctx.actorIdentityId, from: null, to: 'contacting', note: null }],
  };
  let inserted: 'inserted' | 'exists';
  try {
    inserted = await insertFaxTest(record, mode);
  } catch (error) {
    await releaseFaxTestLock(ctx.organizationId, id, mode).catch(() => undefined);
    console.error('Fax test: could not record the attempt:', error instanceof Error ? error.message : error);
    throw new FaxTestError('Nothing was sent. The test could not be recorded before contacting Outlook. Please try again.', 503);
  }
  if (inserted === 'exists') {
    await releaseFaxTestLock(ctx.organizationId, id, mode).catch(() => undefined);
    const same = await getFaxTest(ctx.organizationId, id, mode);
    if (same) return { duplicate: true, transmission: view(same, null) };
    throw new FaxTestError('Nothing was sent. Please try again.', 503);
  }
  try {
    await audit(ctx, ACTIVITY_EVENT_TYPES.FAX_TEST_ATTEMPTED, record, `${describe(record)}: contacting Outlook (${mailbox.accountEmail}).`, {}, 'info', mode);
  } catch (error) {
    // No audit, no send.
    await updateFaxTestIf(record, { status: 'not_sent', failureMessage: 'The attempt could not be audited.' }, { actorId: ctx.actorIdentityId, note: 'audit failed' }, mode).catch(() => null);
    await releaseFaxTestLock(ctx.organizationId, id, mode).catch(() => undefined);
    console.error('Fax test: could not audit the attempt:', error instanceof Error ? error.message : error);
    throw new FaxTestError('Nothing was sent. The test could not be recorded in the audit log. Please try again.', 503);
  }

  let sent: Awaited<ReturnType<typeof sendOutlookMessage>>;
  try {
    // Exactly the Send Fax call: one recipient, no cc, the subject, the (empty) plain-text body, ONE PDF.
    sent = await sendOutlookMessage(mailbox.accessToken, {
      to: [recipient.address],
      cc: [],
      subject: email.subject,
      bodyText: email.body,
      attachments: [{ name: record.attachmentName, contentType: 'application/pdf', bytes: pdf }],
    });
  } catch (error) {
    const notSent = error instanceof OutlookMailError && !error.mayHaveSent;
    const reason = error instanceof OutlookMailError ? error.message : 'The connection to Outlook failed.';
    if (notSent) {
      const saved = await updateFaxTestIf(record, { status: 'not_sent', failureMessage: reason }, { actorId: ctx.actorIdentityId, note: reason }, mode).catch(() => null);
      if (saved) await releaseFaxTestLock(ctx.organizationId, id, mode).catch(() => undefined);
      await audit(ctx, ACTIVITY_EVENT_TYPES.FAX_TEST_NOT_SENT, record, `${describe(record)} was not sent: ${reason}`, { error: reason }, 'warning', mode).catch(() => undefined);
      throw new FaxTestError(`${reason} Nothing was sent.`, 502);
    }
    // Unknown: it may have gone out. Never retried; stays open (locked) until an administrator records what happened.
    await updateFaxTestIf(record, { status: 'needs_review', failureMessage: reason }, { actorId: ctx.actorIdentityId, note: reason }, mode).catch(() => null);
    await audit(ctx, ACTIVITY_EVENT_TYPES.FAX_TEST_NEEDS_REVIEW, record, `${describe(record)} may have been sent: ${reason} It is not retried; record what happened after checking Sent Items in ${mailbox.accountEmail}${record.kind === 'fax' ? ' and NuSo' : ''}.`, { error: reason }, 'warning', mode).catch(() => undefined);
    throw new FaxTestError(`${reason} The test may still have been sent. It will not be retried. Check Sent Items in ${mailbox.accountEmail}${record.kind === 'fax' ? ' and NuSo' : ''}, then record what happened.`, 502);
  }

  // Outlook accepted it. That is submission — not NuSo acceptance, not delivery.
  const submittedAt = new Date().toISOString();
  const submitted = await updateFaxTestIf(record, { status: 'submitted', submittedAt, outlookDraftId: sent.draftId, internetMessageId: sent.internetMessageId }, { actorId: ctx.actorIdentityId, note: null }, mode).catch(() => null);
  await audit(
    ctx,
    ACTIVITY_EVENT_TYPES.FAX_TEST_SUBMITTED,
    record,
    `${describe(record)}: submitted to Outlook from ${mailbox.accountEmail}${record.kind === 'fax' ? '; NuSo acceptance and delivery not yet confirmed' : '; not yet inspected'}${submitted ? '' : '. SOLIS could not save this on the test record; it needs review'}.`,
    { internetMessageId: sent.internetMessageId, recorded: submitted !== null },
    submitted ? 'info' : 'warning',
    mode,
  ).catch(() => undefined);
  const latest = submitted ?? (await getFaxTest(ctx.organizationId, id, mode)) ?? record;
  return { duplicate: false, transmission: view(latest, id) };
}

// ---------------------------------------------------------------- outcomes

export type FaxTestOutcomeInput = { status?: unknown; expectedRevision?: unknown; pagesReceived?: unknown; nusoReference?: unknown; checks?: unknown; note?: unknown };

const cleanText = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new FaxTestError('Notes and references must be plain text.', 400);
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length > max || /[\u0000-\u001f<>]/.test(text)) throw new FaxTestError(`Use plain text of at most ${max} characters.`, 400);
  return text || null;
};

/**
 * An administrator records what happened next: NuSo acceptance, delivery
 * (with the pages actually received, or the dry-run inspection), failure,
 * or — after a "needs review" — that nothing was sent. Each is audited.
 * The organization's lock is released only when the test is resolved.
 */
export async function recordFaxTestOutcome(ctx: ActivityContext, transmissionId: unknown, rawInput: unknown, mode: DataAdapterMode): Promise<FaxTestView> {
  await authorize(ctx, mode);
  const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as FaxTestOutcomeInput;
  const t = typeof transmissionId === 'string' ? await getFaxTest(ctx.organizationId, transmissionId, mode) : null;
  if (!t) throw new FaxTestError('Test transmission not found.', 404);
  if (input.expectedRevision !== t.revision) throw new FaxTestError('Someone else recorded this test since you opened it. Reload and check.', 409);
  const status = input.status as FaxTestStatus;
  if (!nextFaxTestStatuses(t.status, t.kind).includes(status)) throw new FaxTestError(`"${FAX_TEST_STATUS_LABEL[status] ?? String(status)}" cannot be recorded for a test that is "${FAX_TEST_STATUS_LABEL[t.status]}".`, 409);

  const note = cleanText(input.note, 500);
  const nusoReference = cleanText(input.nusoReference, 100);
  const now = new Date().toISOString();
  const patch: Parameters<typeof updateFaxTestIf>[1] = { status, note: note ?? t.note, updatedBy: ctx.actorIdentityId };
  if (nusoReference) patch.nusoReference = nusoReference;

  if (status === 'not_sent') {
    if (!note) throw new FaxTestError('Say how you confirmed nothing was sent (Sent Items, NuSo).', 400);
    patch.passed = null;
  } else if (status === 'nuso_accepted') {
    patch.nusoAcceptedAt = now;
  } else if (status === 'delivered') {
    patch.outcomeAt = now;
    if (t.kind === 'fax') {
      const pages = input.pagesReceived;
      if (typeof pages !== 'number' || !Number.isInteger(pages) || pages < 0 || pages > 50) throw new FaxTestError('Enter the number of pages actually received (0–50).', 400);
      patch.pagesReceived = pages;
      patch.passed = pages === t.pages;
    } else {
      const raw = (input.checks && typeof input.checks === 'object' ? input.checks : {}) as Record<string, unknown>;
      const checks = Object.fromEntries((Object.keys(EMAIL_DRY_RUN_CHECKS) as EmailDryRunCheck[]).map((k) => [k, raw[k]]));
      if (Object.values(checks).some((v) => typeof v !== 'boolean')) throw new FaxTestError('Answer every dry-run check.', 400);
      patch.checks = checks as Record<EmailDryRunCheck, boolean>;
      patch.passed = Object.values(checks).every((v) => v === true);
    }
  } else if (status === 'failed') {
    patch.outcomeAt = now;
    patch.passed = false;
  }

  const saved = await updateFaxTestIf(t, patch, { actorId: ctx.actorIdentityId, note }, mode);
  if (!saved) throw new FaxTestError('Someone else recorded this test since you opened it. Reload and check.', 409);
  if (FAX_TEST_FINAL.includes(status)) await releaseFaxTestLock(ctx.organizationId, t.id, mode);
  const result = status === 'delivered' ? (saved.passed ? ' — PASSED' : ' — DID NOT PASS') : '';
  const detail =
    status === 'delivered' && t.kind === 'fax'
      ? `: ${saved.pagesReceived} page(s) received, ${t.pages} sent`
      : status === 'delivered'
        ? `: dry-run checks ${Object.entries(saved.checks ?? {}).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all held'}`
        : '';
  await audit(
    ctx,
    ACTIVITY_EVENT_TYPES.FAX_TEST_OUTCOME_RECORDED,
    saved,
    `${describe(saved)}: ${FAX_TEST_STATUS_LABEL[status]}${detail}${result}.`,
    { from: t.status, to: status, pagesReceived: saved.pagesReceived, checks: saved.checks, passed: saved.passed, nusoReference: saved.nusoReference, note },
    status === 'delivered' && saved.passed ? 'info' : status === 'nuso_accepted' ? 'info' : 'warning',
    mode,
  );
  const lock = await getFaxTestLock(ctx.organizationId, mode);
  return view(saved, lock?.transmissionId ?? null);
}
