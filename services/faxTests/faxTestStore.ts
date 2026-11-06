import crypto from 'crypto';
import type { DataAdapterMode } from '@/lib/env';
import { faxTableFor } from '../faxBundles/faxBundleStore';
import type { EmailDryRunCheck, FaxTestKind, FaxTestStatus, FaxTestStep } from '@/domain/faxBundles/faxTest';

/**
 * Fax test transmissions (2026-11) — persistence. ONE Wix collection,
 * `faxTestTransmissions` (docs/FAX_TEST_TRANSMISSIONS.md), holding two kinds
 * of row, both with FIXED ids so Wix's refusal of a second insert of the
 * same id (HTTP 409) is the atomic guard:
 *
 *   transmission  id from (organization, submission id): the same request
 *                 twice — double click, retry, two tabs — finds its own
 *                 record and sends nothing more.
 *   lock          id from the organization alone: at most ONE test may be
 *                 open (not yet resolved) per organization; a second
 *                 request, with any submission id, is refused until an
 *                 administrator records how the first one ended.
 *
 * Separate from faxBundles on purpose: a test never touches a real bundle,
 * case or checklist. Only services/faxTests/faxTestService.ts imports this.
 */

export const FAX_TEST_COLLECTION = 'faxTestTransmissions';

type Row = Record<string, unknown>;
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 40);
export const faxTestId = (organizationId: string, submissionId: string) => `fxt-${hash(`fax-test|${organizationId}|${submissionId}`)}`;
export const faxTestLockId = (organizationId: string) => `fxl-${hash(`fax-test-lock|${organizationId}`)}`;

export type FaxTestTransmission = {
  id: string;
  organizationId: string;
  submissionId: string;
  step: FaxTestStep;
  kind: FaxTestKind;
  pages: 1 | 2;
  recipientKey: string;
  recipientAddress: string;
  recipientDisplay: string;
  senderAddress: string;
  subject: string;
  attachmentName: string;
  pdfChecksumSha256: string;
  pdfSizeBytes: number;
  status: FaxTestStatus;
  revision: number;
  requestedBy: string | null;
  createdAt: string;
  /** Written before Outlook is contacted. */
  outlookContactedAt: string;
  /** Outlook (Graph) accepted the message. */
  submittedAt: string | null;
  outlookDraftId: string | null;
  internetMessageId: string | null;
  failureMessage: string | null;
  /** NuSo acknowledged it. */
  nusoAcceptedAt: string | null;
  nusoReference: string | null;
  /** Delivered (fax) / received and inspected (dry run), or failed. */
  outcomeAt: string | null;
  pagesReceived: number | null;
  /** Dry run only: each inspection check, true = held. */
  checks: Partial<Record<EmailDryRunCheck, boolean>> | null;
  /** Delivered exactly as sent: the right page count / every dry-run check. */
  passed: boolean | null;
  note: string | null;
  updatedAt: string;
  updatedBy: string | null;
  history: Array<{ at: string; actorId: string | null; from: FaxTestStatus | null; to: FaxTestStatus; note: string | null }>;
};

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function fromRow(row: Row): FaxTestTransmission {
  let checks: FaxTestTransmission['checks'] = null;
  if (typeof row.checks === 'string' && row.checks) {
    try {
      checks = JSON.parse(row.checks) as FaxTestTransmission['checks'];
    } catch {
      checks = null;
    }
  }
  return {
    id: str(row.beaconFaxTestId),
    organizationId: str(row.organizationId),
    submissionId: str(row.submissionId),
    step: (numOrNull(row.step) ?? 0) as FaxTestStep,
    kind: row.kind === 'fax' ? 'fax' : 'email_dry_run',
    pages: row.pages === 2 ? 2 : 1,
    recipientKey: str(row.recipientKey),
    recipientAddress: str(row.recipientAddress),
    recipientDisplay: str(row.recipientDisplay),
    senderAddress: str(row.senderAddress),
    subject: str(row.subject),
    attachmentName: str(row.attachmentName),
    pdfChecksumSha256: str(row.pdfChecksumSha256),
    pdfSizeBytes: numOrNull(row.pdfSizeBytes) ?? 0,
    status: str(row.status, 'needs_review') as FaxTestStatus,
    revision: numOrNull(row.revision) ?? 0,
    requestedBy: strOrNull(row.requestedBy),
    createdAt: str(row.createdAt),
    outlookContactedAt: str(row.outlookContactedAt),
    submittedAt: strOrNull(row.submittedAt),
    outlookDraftId: strOrNull(row.outlookDraftId),
    internetMessageId: strOrNull(row.internetMessageId),
    failureMessage: strOrNull(row.failureMessage),
    nusoAcceptedAt: strOrNull(row.nusoAcceptedAt),
    nusoReference: strOrNull(row.nusoReference),
    outcomeAt: strOrNull(row.outcomeAt),
    pagesReceived: numOrNull(row.pagesReceived),
    checks,
    passed: typeof row.passed === 'boolean' ? row.passed : null,
    note: strOrNull(row.note),
    updatedAt: str(row.updatedAt),
    updatedBy: strOrNull(row.updatedBy),
    history: Array.isArray(row.history) ? (row.history as FaxTestTransmission['history']) : [],
  };
}

function toRow(t: FaxTestTransmission): Row {
  const { id, checks, ...rest } = t;
  return { beaconFaxTestId: id, recordType: 'transmission', ...rest, checks: checks ? JSON.stringify(checks) : null };
}

/** Inserts the transmission record. 'exists' = this submission was already made. */
export async function insertFaxTest(t: FaxTestTransmission, mode: DataAdapterMode): Promise<'inserted' | 'exists'> {
  return faxTableFor(mode).insert(FAX_TEST_COLLECTION, t.id, toRow(t));
}

export async function getFaxTest(organizationId: string, id: string, mode: DataAdapterMode): Promise<FaxTestTransmission | null> {
  if (!/^fxt-[0-9a-f]{40}$/.test(id)) return null;
  const [row] = await faxTableFor(mode).find(FAX_TEST_COLLECTION, { beaconFaxTestId: id, organizationId, recordType: 'transmission' }, { limit: 1 });
  return row ? fromRow(row) : null;
}

export async function listFaxTests(organizationId: string, mode: DataAdapterMode): Promise<FaxTestTransmission[]> {
  const rows = await faxTableFor(mode).find(FAX_TEST_COLLECTION, { organizationId, recordType: 'transmission' });
  return rows
    .map(fromRow)
    .filter((t) => t.organizationId === organizationId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Conditioned on the revision read: two administrators recording at once — the second is refused. */
export async function updateFaxTestIf(
  expected: FaxTestTransmission,
  patch: Partial<Omit<FaxTestTransmission, 'id' | 'organizationId' | 'revision' | 'history'>>,
  entry: { actorId: string | null; note: string | null },
  mode: DataAdapterMode,
): Promise<FaxTestTransmission | null> {
  const at = patch.updatedAt ?? new Date().toISOString();
  const history = patch.status && patch.status !== expected.status ? [...expected.history, { at, actorId: entry.actorId, from: expected.status, to: patch.status, note: entry.note }] : expected.history;
  const fields: Row = { ...patch, updatedAt: at, revision: expected.revision + 1, history };
  if ('checks' in patch) fields.checks = patch.checks ? JSON.stringify(patch.checks) : null;
  const outcome = await faxTableFor(mode).patchIf(FAX_TEST_COLLECTION, expected.id, fields, { organizationId: expected.organizationId, revision: expected.revision });
  if (outcome !== 'applied') return null;
  return getFaxTest(expected.organizationId, expected.id, mode);
}

// ---------------------------------------------------------------- the one-open-test lock

export type FaxTestLock = { transmissionId: string; createdAt: string };

/** 'held' = another test is open (its id is returned). */
export async function acquireFaxTestLock(organizationId: string, transmissionId: string, mode: DataAdapterMode): Promise<{ acquired: true } | { acquired: false; holder: FaxTestLock | null }> {
  const id = faxTestLockId(organizationId);
  const now = new Date().toISOString();
  const outcome = await faxTableFor(mode).insert(FAX_TEST_COLLECTION, id, { beaconFaxTestId: id, recordType: 'lock', organizationId, transmissionId, createdAt: now });
  if (outcome === 'inserted') return { acquired: true };
  return { acquired: false, holder: await getFaxTestLock(organizationId, mode) };
}

export async function getFaxTestLock(organizationId: string, mode: DataAdapterMode): Promise<FaxTestLock | null> {
  const [row] = await faxTableFor(mode).find(FAX_TEST_COLLECTION, { beaconFaxTestId: faxTestLockId(organizationId), organizationId, recordType: 'lock' }, { limit: 1 });
  return row ? { transmissionId: str(row.transmissionId), createdAt: str(row.createdAt) } : null;
}

/** Released only when the test it guards is resolved (not sent, delivered or failed). */
export async function releaseFaxTestLock(organizationId: string, transmissionId: string, mode: DataAdapterMode): Promise<void> {
  const lock = await getFaxTestLock(organizationId, mode);
  if (lock && lock.transmissionId === transmissionId) await faxTableFor(mode).remove(FAX_TEST_COLLECTION, faxTestLockId(organizationId));
}
