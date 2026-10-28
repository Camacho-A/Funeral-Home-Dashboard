import type { DataAdapterMode } from '@/lib/env';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';
import type { ActivityContext } from './activityService';
import { recordCaseSsnEvent } from './activityService';
import { ACTIVITY_EVENT_TYPES } from '@/types/activityEvent';
import { loadCaseRow, updateCaseWithRetry, writeMockCase } from './caseWriteService';
import { listCaseSubmissionsNewestFirst } from './externalForms/caseSubmissions';
import { fetchSubmissionAnswers } from '@/lib/jotform/jotformClient';
import { decryptSsn, encryptSsn, isSsnEncryptionConfigured } from '@/lib/identity/ssnEncryption';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import { ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, VITAL_STATISTICS_EXTERNAL_FORM_ID } from '@/domain/externalForms/fieldMapping';
import { normalizeSsn } from '@/domain/documents/manateeDeathCertificateApplication';
import {
  CASE_SSN_RAW_FIELD,
  CASE_SSN_SOURCE_LABEL,
  caseSsnSummary,
  readStoredCaseSsn,
  type CaseSsnSource,
  type CaseSsnSummary,
  type StoredCaseSsn,
} from '@/domain/cases/caseSsn';

/**
 * Case SSN (2026-10): capture, locked storage, and administrator
 * correction. See domain/cases/caseSsn.ts.
 *
 *   - Captured from the Arrangement Form (else the Vital Statistics form),
 *     read-only from Jotform, when the form reaches the case — and, for a
 *     case whose form arrived earlier, the first time it is needed (the
 *     Manatee County application). Never a bulk change to existing cases.
 *   - Once stored it is never overwritten by a capture: a later or
 *     different form leaves it as it is. Only an administrator's correction,
 *     with a reason, replaces it.
 *   - The number is encrypted at rest and never logged, returned to a
 *     browser, or written into an activity entry; staff see the last four.
 *
 * Every capture is best-effort: a failure leaves the case without an SSN
 * (the Manatee application then asks for one) and never fails the form
 * import that triggered it.
 */

export class CaseSsnError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function caseSsnEnabled(organizationId: string): boolean {
  return getRegisteredOrganizationProfile(organizationId).features.caseSsn;
}

/** Which question holds the SSN on each form, best source first. */
const SSN_QUESTION: Record<string, { qid: string; source: Exclude<CaseSsnSource, 'admin_correction'> }> = {
  [ARRANGEMENT_FORMS_EXTERNAL_FORM_ID]: { qid: '11', source: 'arrangement_form' },
  [VITAL_STATISTICS_EXTERNAL_FORM_ID]: { qid: '7', source: 'vital_statistics' },
};
const SOURCE_PRIORITY: readonly CaseSsnSource[] = ['arrangement_form', 'vital_statistics'];

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Mock mode keeps the stored record beside the fixtures, never on them. */
const mockStore = ((globalThis as { __solisMockCaseSsn?: Map<string, StoredCaseSsn> }).__solisMockCaseSsn ??= new Map());
const mockKey = (organizationId: string, caseId: string) => `${organizationId}:${caseId}`;

export function resetMockCaseSsn(): void {
  mockStore.clear();
}

async function readStored(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<StoredCaseSsn | null> {
  if (mode === 'mock') return mockStore.get(mockKey(organizationId, caseId)) ?? null;
  const row = await loadCaseRow(organizationId, caseId);
  return row ? readStoredCaseSsn((row.data as Record<string, unknown>)[CASE_SSN_RAW_FIELD]) : null;
}

/**
 * Writes the record. `replace` is only for an administrator's correction;
 * a capture never replaces an SSN already on the case — checked against the
 * row being written, so two captures racing can't both land.
 */
async function writeStored(
  organizationId: string,
  caseId: string,
  build: (current: StoredCaseSsn | null) => StoredCaseSsn | null,
  mode: DataAdapterMode,
): Promise<'written' | 'kept' | 'not_found'> {
  if (mode === 'mock') {
    const current = mockStore.get(mockKey(organizationId, caseId)) ?? null;
    const next = build(current);
    if (!next) return 'kept';
    const updated = writeMockCase(organizationId, caseId, (c) => ({ ...c, ssnOnFile: caseSsnSummary(next) }));
    if (!updated) return 'not_found';
    mockStore.set(mockKey(organizationId, caseId), next);
    return 'written';
  }
  const outcome = await updateCaseWithRetry(organizationId, caseId, (row) => {
    if (row.case_.isDeleted) return null;
    const next = build(readStoredCaseSsn((row.data as Record<string, unknown>)[CASE_SSN_RAW_FIELD]));
    return next ? { [CASE_SSN_RAW_FIELD]: next } : null;
  });
  if (outcome.result === 'applied') return 'written';
  if (outcome.result === 'unchanged') return 'kept';
  if (outcome.result === 'not_found') return 'not_found';
  throw new Error(`The Social Security number could not be saved (${outcome.result}).`);
}

const record = (ssn: string, source: CaseSsnSource, actorId: string | null, at: string): StoredCaseSsn => ({
  ciphertext: encryptSsn(ssn),
  last4: ssn.slice(-4),
  source,
  capturedAt: at,
  capturedBy: actorId,
  correctedAt: null,
  correctedBy: null,
  correctionReason: null,
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getCaseSsnSummary(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<CaseSsnSummary | null> {
  const stored = await readStored(organizationId, caseId, mode);
  return stored ? caseSsnSummary(stored) : null;
}

/** The full number — server only, for the Manatee County application. */
export async function readCaseSsn(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<{ ssn: string; summary: CaseSsnSummary } | null> {
  if (!caseSsnEnabled(organizationId) || !isSsnEncryptionConfigured()) return null;
  const stored = await readStored(organizationId, caseId, mode);
  if (!stored) return null;
  try {
    const ssn = normalizeSsn(decryptSsn(stored.ciphertext));
    return ssn ? { ssn, summary: caseSsnSummary(stored)! } : null;
  } catch {
    // A wrong or rotated key: treated as not on file — never thrown with detail.
    console.error('A stored Social Security number could not be decrypted.');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export type CaptureOutcome = 'captured' | 'already_on_file' | 'none_found' | 'not_applicable';

async function ssnFromSubmission(submission: ExternalFormSubmission): Promise<{ ssn: string; source: Exclude<CaseSsnSource, 'admin_correction'> } | null> {
  const question = SSN_QUESTION[submission.externalFormId];
  if (!question || submission.provider !== 'jotform' || !submission.externalSubmissionId) return null;
  try {
    const { answers } = await fetchSubmissionAnswers(submission.externalSubmissionId);
    const answer = answers[question.qid]?.answer;
    const ssn = normalizeSsn(typeof answer === 'string' ? answer : null);
    return ssn ? { ssn, source: question.source } : null;
  } catch {
    // Never the provider's error text.
    return null;
  }
}

async function store(ctx: ActivityContext, caseId: string, found: { ssn: string; source: CaseSsnSource }, mode: DataAdapterMode): Promise<CaptureOutcome> {
  const result = await writeStored(ctx.organizationId, caseId, (current) => (current ? null : record(found.ssn, found.source, null, new Date().toISOString())), mode);
  if (result !== 'written') return result === 'kept' ? 'already_on_file' : 'not_applicable';
  await recordCaseSsnEvent(
    { ...ctx, actorIdentityId: null, isSystemGenerated: true },
    caseId,
    ACTIVITY_EVENT_TYPES.CASE_SSN_CAPTURED,
    { description: `Social Security number saved and locked — ${CASE_SSN_SOURCE_LABEL[found.source].toLowerCase()}`, record: { source: found.source } },
    mode,
  ).catch(() => console.error('Failed to record the SSN capture in the case activity.'));
  return 'captured';
}

/** When an Arrangement or Vital Statistics form reaches a case. */
export async function captureCaseSsnFromSubmission(
  ctx: ActivityContext,
  caseId: string,
  submission: ExternalFormSubmission,
  mode: DataAdapterMode,
): Promise<CaptureOutcome> {
  try {
    if (!caseSsnEnabled(ctx.organizationId) || !isSsnEncryptionConfigured() || !SSN_QUESTION[submission.externalFormId]) return 'not_applicable';
    if (await readStored(ctx.organizationId, caseId, mode)) return 'already_on_file';
    const found = await ssnFromSubmission(submission);
    return found ? await store(ctx, caseId, found, mode) : 'none_found';
  } catch {
    console.error('Capturing the Social Security number from the form failed.');
    return 'none_found';
  }
}

/** For a case whose forms arrived earlier: the first time the SSN is needed. */
export async function captureCaseSsnFromForms(ctx: ActivityContext, caseId: string, mode: DataAdapterMode): Promise<CaptureOutcome> {
  try {
    if (!caseSsnEnabled(ctx.organizationId) || !isSsnEncryptionConfigured()) return 'not_applicable';
    if (await readStored(ctx.organizationId, caseId, mode)) return 'already_on_file';
    const submissions = (await listCaseSubmissionsNewestFirst(ctx.organizationId, caseId, mode)).filter((s) => SSN_QUESTION[s.externalFormId]);
    const ordered = SOURCE_PRIORITY.flatMap((source) => submissions.filter((s) => SSN_QUESTION[s.externalFormId].source === source));
    for (const submission of ordered) {
      const found = await ssnFromSubmission(submission);
      if (found) return await store(ctx, caseId, found, mode);
    }
    return 'none_found';
  } catch {
    console.error('Capturing the Social Security number from the forms failed.');
    return 'none_found';
  }
}

// ---------------------------------------------------------------------------
// Administrator correction
// ---------------------------------------------------------------------------

/** Replaces the locked SSN. The caller has already checked the caller is an
    administrator and the reason is valid (see the route). */
export async function correctCaseSsn(ctx: ActivityContext, caseId: string, input: { ssn: string; reason: string }, mode: DataAdapterMode): Promise<CaseSsnSummary> {
  if (!caseSsnEnabled(ctx.organizationId)) throw new CaseSsnError('Not available for this organization.', 404);
  if (!isSsnEncryptionConfigured()) throw new CaseSsnError('Social Security number storage is not set up yet.', 503);
  const ssn = normalizeSsn(input.ssn);
  if (!ssn) throw new CaseSsnError('A Social Security number has 9 digits.', 400);
  const at = new Date().toISOString();
  const result = await writeStored(
    ctx.organizationId,
    caseId,
    (current) => ({
      ...record(ssn, 'admin_correction', ctx.actorIdentityId, at),
      capturedAt: current?.capturedAt ?? at,
      capturedBy: current?.capturedBy ?? ctx.actorIdentityId,
      correctedAt: at,
      correctedBy: ctx.actorIdentityId,
      correctionReason: input.reason,
    }),
    mode,
  );
  if (result === 'not_found') throw new CaseSsnError('Case not found.', 404);
  await recordCaseSsnEvent(
    ctx,
    caseId,
    ACTIVITY_EVENT_TYPES.CASE_SSN_CORRECTED,
    { description: `Social Security number corrected by an administrator — ${input.reason}`, record: { reason: input.reason } },
    mode,
  ).catch(() => console.error('Failed to record the SSN correction in the case activity.'));
  return (await getCaseSsnSummary(ctx.organizationId, caseId, mode))!;
}
