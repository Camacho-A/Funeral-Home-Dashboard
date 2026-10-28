import crypto from 'crypto';
import type { DataAdapterMode } from '@/lib/env';
import type { Case, CaseCrematoryRecord, CaseUpdate } from '@/types/case';
import type { CaseDocument } from '@/types/caseDocument';
import type { ActivityContext } from '../activityService';
import { recordCrematoryEvent } from '../activityService';
import { ACTIVITY_EVENT_TYPES } from '@/types/activityEvent';
import { generateBillingDocument, list as listCaseDocuments, readStoredCaseDocument, attachDocumentActorDisplayNames } from '../documentService';
import { loadCaseOnServer } from '../serverCaseLoader';
import { listForOrganization } from '../casesService';
import { updateCaseWithRetry, writeMockCase } from '../caseWriteService';
import { buildCaseFieldPatch } from '@/lib/wixCaseMapper';
import { getAppointment } from '../scheduling/appointmentReads';
import { expectedPickupAppointmentId } from '../cremainsPickupService';
import { expectedDateOf } from '@/domain/scheduling/cremainsPickupPresentation';
import { getOrganization } from '../organizationProvisioningService';
import { DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';
import { ARRANGEMENT_EXTRACTS, ARRANGEMENT_FORMS_DOCUMENT_TYPE_KEY, workflowStageComplete } from '@/domain/documents/arrangementPageExtracts';
import {
  crematoryPackageFileName,
  normalizePackageName,
  packageDisplayName,
  parseCaseDate,
  suggestPackageName,
  toCaseDate,
  type PackageName,
} from '@/domain/crematory/crematoryPackage';
import { listForCase as listCaseFormLinks } from '../caseFormLinkService';
import { getById as getSubmissionById } from '../externalFormSubmissionService';
import { queryWixDataItems } from '@/lib/wixDataApi';
import { evaluateCrematoryReadiness, type CrematoryReadiness } from '@/domain/crematory/crematoryReadiness';
import { resolveCrematorySettings, sendToCrematoryConfig, type CrematorySettings } from '@/domain/crematory/crematorySettings';
import { mergePdfs, UnreadablePdfError } from '@/lib/pdf/mergePdfs';
import { toDisplayCasingIfAllCaps } from '@/utils/string';

/**
 * Send to Crematory (2026-10). Everything between "the permit was uploaded"
 * and "the email was submitted", per case:
 *
 *   1. staff confirm the uploaded state permit is the approved permit for
 *      this decedent (that exact file — a replacement needs its own);
 *   2. staff confirm the expected cremation ready date (suggested from the
 *      Expected Pickup, never assumed);
 *   3. the Crematory Package is built: the permit, then page 3 of the
 *      Arrangement Forms (the saved Crematory Form), merged unchanged into
 *      one PDF named LastName_FirstName_MM-DD-YYYY.pdf and saved to the
 *      case's documents — a new version only when something changed;
 *   4. (crematorySendService.ts) one Outlook email carries one package per
 *      selected decedent.
 *
 * Nothing here ever sends anything, and nothing happens because a permit
 * was uploaded: every step is a staff action. Organization rules (the
 * subject's name, the workflow stage that must be complete) come from the
 * organization's profile, so another funeral home can use the same code.
 */
export class CrematoryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CrematoryError';
  }
}

const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
const PERMIT_TYPE = DOCUMENT_TYPES.CREMATION_FORM_STATE_PERMIT.key;
const PACKAGE_TYPE = DOCUMENT_TYPES.CREMATION_FORM_CREMATORY_PACKAGE.key;

export function assertSendToCrematoryEnabled(organizationId: string) {
  const config = sendToCrematoryConfig(organizationId);
  if (!config) throw new CrematoryError('Send to Crematory is not set up for this organization.', 404);
  return config;
}

function latest(documents: CaseDocument[], predicate: (d: CaseDocument) => boolean): CaseDocument | null {
  return documents.filter((d) => d.status === 'active' && predicate(d)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

export const decedentDisplayName = (case_: Pick<Case, 'decedentName'>) => toDisplayCasingIfAllCaps((case_.decedentName ?? '').trim());

type Facts = {
  case_: Case;
  permit: CaseDocument | null;
  arrangementForm: CaseDocument | null;
  crematoryForm: CaseDocument | null;
  package: CaseDocument | null;
  suggestedReadyDate: string | null;
};

/**
 * A package-name suggestion from the decedent's name as an intake form
 * structured it (first / middle / last boxes) — the latest of this case's
 * submissions that carries one. Never derived from the case's full-name
 * string. Null when no submission has it (e.g. every submission received
 * before structured names were kept).
 */
async function suggestedPackageNameFor(organizationId: string, case_: Case, mode: DataAdapterMode): Promise<PackageName | null> {
  try {
    const linked = (await listCaseFormLinks(organizationId, case_.id, mode)).map((link) => link.submissionId).filter((id): id is string => Boolean(id));
    const submissions = (await Promise.all(linked.map((id) => getSubmissionById(id, mode)))).filter((s) => s !== null && s.organizationId === organizationId);
    if (mode === 'mock') {
      const { externalFormSubmissionFixtures } = await import('../__mocks__/externalFormFixtures');
      submissions.push(...externalFormSubmissionFixtures.filter((s) => s.organizationId === organizationId && s.createdCaseId === case_.id));
    } else {
      const created = await queryWixDataItems<{ mappedFields?: unknown; receivedAt?: unknown }>('externalFormSubmissions', {
        filter: { organizationId, createdCaseId: case_.id },
        paging: { limit: 20 },
      });
      for (const item of created.dataItems) {
        submissions.push({ mappedFields: String(item.data.mappedFields ?? '{}'), receivedAt: String(item.data.receivedAt ?? '') } as never);
      }
    }
    const candidates = submissions
      .map((s) => {
        try {
          return { at: s!.receivedAt ?? '', mapped: JSON.parse(s!.mappedFields) as Record<string, string | undefined> };
        } catch {
          return null;
        }
      })
      .filter((c): c is { at: string; mapped: Record<string, string | undefined> } => c !== null && Boolean(c.mapped.decedentFirstName && c.mapped.decedentLastName))
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    const latest = candidates[0];
    return latest
      ? suggestPackageName({ first: latest.mapped.decedentFirstName, middle: latest.mapped.decedentMiddleName ?? case_.decedentMiddleName ?? null, last: latest.mapped.decedentLastName })
      : null;
  } catch (error) {
    console.error('Could not look up a structured name for the package:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** The confirmed package name on the case, if valid. */
function confirmedPackageName(case_: Case): PackageName | null {
  const stored = case_.crematory?.packageName;
  if (!stored) return null;
  const normalized = normalizePackageName(stored);
  return 'error' in normalized ? null : normalized;
}

async function suggestedReadyDate(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<string | null> {
  const appointment = await getAppointment(organizationId, expectedPickupAppointmentId(caseId), mode);
  if (!appointment || appointment.status === 'cancelled') return null;
  return toCaseDate(expectedDateOf(appointment));
}

async function loadFacts(organizationId: string, case_: Case, mode: DataAdapterMode): Promise<Facts> {
  const documents = await listCaseDocuments(organizationId, case_.id, mode);
  return {
    case_,
    permit: latest(documents, (d) => d.documentTypeKey === PERMIT_TYPE),
    arrangementForm: latest(documents, (d) => d.documentTypeKey === ARRANGEMENT_FORMS_DOCUMENT_TYPE_KEY && d.mimeType === 'application/pdf'),
    crematoryForm: latest(documents, (d) => d.documentTypeKey === ARRANGEMENT_EXTRACTS.crematory_form.documentTypeKey && d.origin === 'generated'),
    package: latest(documents, (d) => d.documentTypeKey === PACKAGE_TYPE && d.origin === 'generated'),
    suggestedReadyDate: await suggestedReadyDate(organizationId, case_.id, mode),
  };
}

/** The package file name the current case and confirmed date call for. */
function expectedFileName(facts: Facts): string | null {
  return crematoryPackageFileName(confirmedPackageName(facts.case_), facts.case_.crematory?.readyDate?.date ?? null);
}

/** Whether the saved package is exactly what the current permit, page 3
    and confirmed date produce (recorded when it was built). */
function packageIsCurrent(facts: Facts): boolean {
  const build = facts.case_.crematory?.lastBuild;
  return Boolean(
    facts.package &&
      build &&
      build.packageDocumentId === facts.package.id &&
      facts.permit &&
      build.permitChecksumSha256 === facts.permit.checksumSha256 &&
      facts.crematoryForm &&
      build.crematoryFormChecksumSha256 === facts.crematoryForm.checksumSha256 &&
      facts.package.fileName === expectedFileName(facts),
  );
}

function readinessOf(facts: Facts, canSend: boolean): CrematoryReadiness {
  const config = sendToCrematoryConfig(facts.case_.organizationId);
  const record = facts.case_.crematory ?? {};
  return evaluateCrematoryReadiness({
    caseType: facts.case_.caseType,
    isArchived: facts.case_.isDeleted === true,
    sentAt: facts.case_.crematory?.lastSubmission?.status === 'submitted' ? facts.case_.crematory.lastSubmission.at : null,
    workflow2Complete: config ? workflowStageComplete(facts.case_, config.authorizationWorkflowStage) : null,
    permit: facts.permit ? { documentId: facts.permit.id, checksumSha256: facts.permit.checksumSha256, mimeType: facts.permit.mimeType } : null,
    permitVerification: record.permitVerification ? { documentId: record.permitVerification.documentId, checksumSha256: record.permitVerification.checksumSha256 } : null,
    arrangementForm: facts.arrangementForm ? { createdAt: facts.arrangementForm.createdAt } : null,
    crematoryForm: facts.crematoryForm ? { createdAt: facts.crematoryForm.createdAt } : null,
    packageNameConfirmed: confirmedPackageName(facts.case_) !== null,
    readyDate: {
      suggested: facts.suggestedReadyDate,
      confirmed: record.readyDate ? { date: record.readyDate.date, suggestedAtConfirmation: record.readyDate.suggestedAtConfirmation } : null,
    },
    package: facts.package ? { fileName: facts.package.fileName, current: packageIsCurrent(facts) } : null,
    canSend,
  });
}

export type CrematoryCaseSummary = {
  caseId: string;
  caseNumber: string;
  decedentDisplayName: string;
  /** The confirmed name for the file and subject, and a suggestion from
      the intake form's structured name (never from the full name). */
  packageName: { confirmed: PackageName | null; suggested: PackageName | null };
  /** "First Last" from the confirmed package name, for the subject. */
  subjectName: string;
  readiness: CrematoryReadiness;
  permit: { documentId: string; fileName: string; createdAt: string; uploadedBy: string | null } | null;
  readyDate: { suggested: string | null; confirmed: string | null };
  package: { documentId: string; version: number | null; fileName: string; current: boolean } | null;
  expectedFileName: string | null;
  lastSubmission: CaseCrematoryRecord['lastSubmission'] | null;
};

async function summarize(facts: Facts, canSend: boolean, mode: DataAdapterMode): Promise<CrematoryCaseSummary> {
  const [permitWithName] = facts.permit ? await attachDocumentActorDisplayNames([facts.permit], mode) : [null];
  const confirmedName = confirmedPackageName(facts.case_);
  return {
    caseId: facts.case_.id,
    caseNumber: facts.case_.caseNumber,
    decedentDisplayName: decedentDisplayName(facts.case_),
    packageName: { confirmed: confirmedName, suggested: confirmedName ? null : await suggestedPackageNameFor(facts.case_.organizationId, facts.case_, mode) },
    subjectName: confirmedName ? packageDisplayName(confirmedName) : decedentDisplayName(facts.case_),
    readiness: readinessOf(facts, canSend),
    permit: permitWithName ? { documentId: permitWithName.id, fileName: permitWithName.fileName, createdAt: permitWithName.createdAt, uploadedBy: permitWithName.actorDisplayName } : null,
    readyDate: { suggested: facts.suggestedReadyDate, confirmed: facts.case_.crematory?.readyDate?.date ?? null },
    package: facts.package ? { documentId: facts.package.id, version: facts.package.version, fileName: facts.package.fileName, current: packageIsCurrent(facts) } : null,
    expectedFileName: expectedFileName(facts),
    lastSubmission: facts.case_.crematory?.lastSubmission ?? null,
  };
}

async function loadCase(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<Case> {
  const case_ = await loadCaseOnServer(organizationId, caseId, mode);
  if (!case_) throw new CrematoryError('Case not found.', 404);
  return case_;
}

export async function getCrematoryCaseSummary(organizationId: string, caseId: string, canSend: boolean, mode: DataAdapterMode): Promise<CrematoryCaseSummary> {
  assertSendToCrematoryEnabled(organizationId);
  return summarize(await loadFacts(organizationId, await loadCase(organizationId, caseId, mode), mode), canSend, mode);
}

/** The Cases page batch: every open cremation case (not archived, cremains
    not yet released), each with what it still needs. */
export async function listCrematoryCandidates(organizationId: string, canSend: boolean, mode: DataAdapterMode): Promise<CrematoryCaseSummary[]> {
  assertSendToCrematoryEnabled(organizationId);
  const cases = (await listForOrganization(organizationId, mode)).filter((c) => c.caseType === 'cremation' && !c.isDeleted && c.pickupStatus !== 'released');
  const summaries: CrematoryCaseSummary[] = [];
  for (const case_ of cases) summaries.push(await summarize(await loadFacts(organizationId, case_, mode), canSend, mode));
  // Ready to send first, then those needing attention, then those already sent.
  const rank = (s: CrematoryCaseSummary) => (s.readiness.readyToSend ? 0 : s.lastSubmission?.status === 'submitted' ? 2 : 1);
  return summaries.sort((a, b) => rank(a) - rank(b) || a.caseNumber.localeCompare(b.caseNumber));
}

export async function getOrganizationCrematorySettings(organizationId: string, mode: DataAdapterMode): Promise<CrematorySettings> {
  return resolveCrematorySettings((await getOrganization(organizationId, mode))?.crematorySettings);
}

// ---------------------------------------------------------------------------
// Writes to the case's own `crematory` record — revision-safe, key-merged.
// ---------------------------------------------------------------------------

export async function applyCrematoryRecord(
  organizationId: string,
  caseId: string,
  decide: (case_: Case) => Partial<CaseCrematoryRecord> | null,
  mode: DataAdapterMode,
): Promise<Case | null> {
  if (mode === 'mock') {
    const { caseFixtures } = await import('../__mocks__/fixtures');
    const current = caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId);
    if (!current) throw new CrematoryError('Case not found.', 404);
    const change = decide(current);
    if (!change) return null;
    return writeMockCase(organizationId, caseId, (latestCase) => ({ ...latestCase, crematory: { ...(latestCase.crematory ?? {}), ...change } }));
  }
  const outcome = await updateCaseWithRetry(organizationId, caseId, (row) => {
    const change = decide(row.case_);
    return change ? buildCaseFieldPatch(row.data, { crematory: change } as CaseUpdate) : null;
  });
  if (outcome.result === 'not_found') throw new CrematoryError('Case not found.', 404);
  if (outcome.result === 'conflict') throw new CrematoryError('The case changed while this was being saved. Please try again.', 409);
  if (outcome.result === 'failed') throw new Error(`Crematory update for case ${caseId} failed: ${outcome.reason}`);
  return outcome.result === 'applied' ? outcome.case_ : null;
}

function refuseArchived(case_: Case) {
  if (case_.isDeleted) throw new CrematoryError('This case is archived and read-only.', 409);
}

async function audit(ctx: ActivityContext, caseId: string, eventType: Parameters<typeof recordCrematoryEvent>[2], details: Parameters<typeof recordCrematoryEvent>[3], mode: DataAdapterMode) {
  try {
    await recordCrematoryEvent(ctx, caseId, eventType, details, mode);
  } catch (error) {
    console.error(`Failed to record ${eventType}:`, error instanceof Error ? error.message : error);
  }
}

/** Staff confirm the uploaded permit (that exact file) is the approved
    state permit for this decedent. */
export async function confirmPermit(ctx: ActivityContext, caseId: string, documentId: string, mode: DataAdapterMode, canSend = false): Promise<CrematoryCaseSummary> {
  assertSendToCrematoryEnabled(ctx.organizationId);
  const case_ = await loadCase(ctx.organizationId, caseId, mode);
  refuseArchived(case_);
  const facts = await loadFacts(ctx.organizationId, case_, mode);
  if (!facts.permit || facts.permit.id !== documentId) throw new CrematoryError('That is not the latest state permit uploaded to this case. Reopen and try again.', 409);
  if (facts.permit.mimeType !== 'application/pdf') throw new CrematoryError('The state permit must be a PDF to be included in the Crematory Package.', 422);
  const verifiedAt = new Date().toISOString();
  await applyCrematoryRecord(
    ctx.organizationId,
    caseId,
    (current) => (refuseArchived(current), { permitVerification: { documentId, checksumSha256: facts.permit!.checksumSha256, verifiedBy: ctx.actorIdentityId, verifiedAt } }),
    mode,
  );
  await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_PERMIT_CONFIRMED, {
    resourceId: documentId,
    description: `State permit "${facts.permit.fileName}" confirmed as the approved permit for ${decedentDisplayName(case_)}`,
    record: { documentId, checksumSha256: facts.permit.checksumSha256 },
  }, mode);
  return getCrematoryCaseSummary(ctx.organizationId, caseId, canSend, mode);
}

/** Staff enter or confirm the expected cremation ready date. */
export async function confirmReadyDate(ctx: ActivityContext, caseId: string, date: string, mode: DataAdapterMode, canSend = false): Promise<CrematoryCaseSummary> {
  assertSendToCrematoryEnabled(ctx.organizationId);
  const confirmed = toCaseDate(date);
  if (!confirmed || !parseCaseDate(confirmed)) throw new CrematoryError('Enter a valid expected ready date.', 422);
  const case_ = await loadCase(ctx.organizationId, caseId, mode);
  refuseArchived(case_);
  const suggested = await suggestedReadyDate(ctx.organizationId, caseId, mode);
  const previous = case_.crematory?.readyDate?.date ?? null;
  await applyCrematoryRecord(
    ctx.organizationId,
    caseId,
    (current) => (refuseArchived(current), { readyDate: { date: confirmed, suggestedAtConfirmation: suggested, confirmedBy: ctx.actorIdentityId, confirmedAt: new Date().toISOString() } }),
    mode,
  );
  await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_READY_DATE_CONFIRMED, {
    resourceId: null,
    description: `Expected cremation ready date confirmed: ${confirmed}${previous && previous !== confirmed ? ` (was ${previous})` : ''}`,
    record: { date: confirmed, previous, suggestedFromExpectedPickup: suggested },
  }, mode);
  return getCrematoryCaseSummary(ctx.organizationId, caseId, canSend, mode);
}

/**
 * Staff enter or confirm the last name and first name(s) the package file
 * is named with. Stored with the crematory record only — the case's own
 * name is never changed.
 */
export async function confirmPackageName(
  ctx: ActivityContext,
  caseId: string,
  input: { first?: unknown; last?: unknown },
  mode: DataAdapterMode,
  canSend = false,
): Promise<CrematoryCaseSummary> {
  assertSendToCrematoryEnabled(ctx.organizationId);
  const name = normalizePackageName(input);
  if ('error' in name) throw new CrematoryError(name.error, 422);
  const case_ = await loadCase(ctx.organizationId, caseId, mode);
  refuseArchived(case_);
  const previous = confirmedPackageName(case_);
  await applyCrematoryRecord(
    ctx.organizationId,
    caseId,
    (current) => (refuseArchived(current), { packageName: { ...name, confirmedBy: ctx.actorIdentityId, confirmedAt: new Date().toISOString() } }),
    mode,
  );
  await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_PACKAGE_NAME_CONFIRMED, {
    resourceId: null,
    description: `Name for the Crematory Package confirmed: ${name.last}, ${name.first}${previous && (previous.first !== name.first || previous.last !== name.last) ? ` (was ${previous.last}, ${previous.first})` : ''}`,
    record: { first: name.first, last: name.last, previous },
  }, mode);
  return getCrematoryCaseSummary(ctx.organizationId, caseId, canSend, mode);
}

export type BuildOutcome = { outcome: 'saved' | 'unchanged'; summary: CrematoryCaseSummary };

/**
 * Builds (or rebuilds) the case's Crematory Package from the confirmed
 * permit and the saved page 3. Refused — nothing created — until every
 * requirement for building is met. A package identical to the saved one
 * (same permit, same page 3, same date) is not saved again.
 */
export async function buildCrematoryPackage(ctx: ActivityContext, caseId: string, mode: DataAdapterMode, canSend = false): Promise<BuildOutcome> {
  assertSendToCrematoryEnabled(ctx.organizationId);
  const case_ = await loadCase(ctx.organizationId, caseId, mode);
  const facts = await loadFacts(ctx.organizationId, case_, mode);
  const readiness = readinessOf(facts, true);
  if (!readiness.readyToBuild) {
    const missing = readiness.requirements.filter((r) => !r.ok && r.key !== 'package' && r.key !== 'permission').map((r) => r.detail);
    throw new CrematoryError(`The Crematory Package can't be built yet: ${missing.join(' ')}`, 422);
  }
  if (packageIsCurrent(facts)) return { outcome: 'unchanged', summary: await summarize(facts, canSend, mode) };

  const fileName = expectedFileName(facts)!;
  const [permitBytes, formBytes] = await Promise.all([
    readStoredCaseDocument(ctx.organizationId, caseId, facts.permit!.id, mode),
    readStoredCaseDocument(ctx.organizationId, caseId, facts.crematoryForm!.id, mode),
  ]).catch(() => {
    throw new CrematoryError('The permit or page 3 could not be read from document storage. Nothing was created. Please try again.', 503);
  });
  // The confirmed permit must still be the exact file that was confirmed.
  if (sha256(permitBytes.buffer) !== facts.case_.crematory?.permitVerification?.checksumSha256) {
    throw new CrematoryError('The stored permit does not match the one that was confirmed. Confirm the permit again.', 409);
  }
  let merged: Uint8Array;
  try {
    merged = (
      await mergePdfs([
        { label: 'The state permit', bytes: new Uint8Array(permitBytes.buffer) },
        { label: 'Arrangement Form page 3', bytes: new Uint8Array(formBytes.buffer) },
      ])
    ).bytes;
  } catch (error) {
    if (error instanceof UnreadablePdfError) throw new CrematoryError(`${error.message} Nothing was created.`, 422);
    throw error;
  }

  const document = await generateBillingDocument(
    {
      caseId,
      documentTypeKey: PACKAGE_TYPE,
      category: DOCUMENT_TYPES.CREMATION_FORM_CREMATORY_PACKAGE.category,
      fileName,
      existingDocumentId: facts.package?.id,
      idFactory: () => crypto.randomUUID(),
      buildPdf: async () => merged,
    },
    ctx,
    mode,
  );
  const builtAt = new Date().toISOString();
  await applyCrematoryRecord(
    ctx.organizationId,
    caseId,
    () => ({
      lastBuild: {
        packageDocumentId: document.id,
        permitChecksumSha256: facts.permit!.checksumSha256,
        crematoryFormChecksumSha256: facts.crematoryForm!.checksumSha256,
        fileName,
        builtAt,
        builtBy: ctx.actorIdentityId,
      },
    }),
    mode,
  );
  await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_PACKAGE_BUILT, {
    resourceId: document.id,
    description: `Crematory Package v${document.version ?? 1} built: ${fileName}`,
    record: { version: document.version, fileName, permitDocumentId: facts.permit!.id, crematoryFormDocumentId: facts.crematoryForm!.id, checksumSha256: document.checksumSha256 },
  }, mode);
  return { outcome: 'saved', summary: await getCrematoryCaseSummary(ctx.organizationId, caseId, canSend, mode) };
}

/** For the send service: the case, its readiness and its package. */
export async function loadForSending(organizationId: string, caseId: string, mode: DataAdapterMode) {
  const case_ = await loadCase(organizationId, caseId, mode);
  const facts = await loadFacts(organizationId, case_, mode);
  return { case_, facts, readiness: readinessOf(facts, true), summary: await summarize(facts, true, mode) };
}
