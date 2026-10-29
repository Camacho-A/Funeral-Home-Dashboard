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
  legacyCrematoryPackageFileName,
  normalizePackageName,
  packageDisplayName,
  parseCaseDate,
  suggestPackageName,
  toCaseDate,
  type PackageName,
} from '@/domain/crematory/crematoryPackage';
import { listCaseSubmissionsNewestFirst } from '../externalForms/caseSubmissions';
import { fetchSubmissionAnswers } from '@/lib/jotform/jotformClient';
import { extractMappedFieldsForForm } from '@/domain/externalForms/arrangementNokDerivation';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';
import { evaluateCrematoryReadiness, type CrematoryReadiness } from '@/domain/crematory/crematoryReadiness';
import { resolveCrematorySettings, sendToCrematoryConfig, type CrematorySettings } from '@/domain/crematory/crematorySettings';
import { mergePdfs, UnreadablePdfError } from '@/lib/pdf/mergePdfs';
import { toDisplayCasingIfAllCaps } from '@/utils/string';
import { ArrangementExtractError, extractArrangementPage } from '../arrangementPageExtractService';

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
 * Nothing here ever sends anything. Staff confirm the permit, the name and
 * the date; everything else is prepared automatically (2026-10,
 * prepareCrematoryDocuments below): page 3 is extracted when an
 * Arrangement Form arrives or changes, and the package is built as soon as
 * everything it needs is confirmed — and rebuilt when a source changes.
 * Organization rules (the subject's name, the workflow stage that must be
 * complete) come from the organization's profile, so another funeral home
 * can use the same code.
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

export type PackageNameSuggestion = { name: PackageName; source: 'form' | 'case_name' };

/** Structured names read from Jotform, once per submission per server. */
const jotformNameCache = new Map<string, Promise<Partial<Record<string, string>> | null>>();

async function structuredNameFromJotform(submission: ExternalFormSubmission): Promise<Partial<Record<string, string>> | null> {
  if (submission.provider !== 'jotform' || !submission.externalSubmissionId || !process.env.JOTFORM_API_KEY) return null;
  let pending = jotformNameCache.get(submission.id);
  if (!pending) {
    pending = fetchSubmissionAnswers(submission.externalSubmissionId)
      .then(({ answers }) => extractMappedFieldsForForm(submission, answers) as Partial<Record<string, string>>)
      .catch(() => null);
    jotformNameCache.set(submission.id, pending);
  }
  return pending;
}

/**
 * Fills in the package name for staff to confirm (2026-10), from the most
 * reliable source available:
 *   1. the decedent's name as an intake form structured it — the first /
 *      middle / last boxes — kept on the submission, or (for submissions
 *      received before those were kept) read back from Jotform, read-only;
 *   2. otherwise a case name of exactly two words ("RICHARD REYNOLDS"),
 *      which can only mean first and last;
 *   3. otherwise nothing: a longer name ("MARY ANN SMITH") cannot say which
 *      words are the surname, so staff type it.
 * Always a suggestion — staff confirm it before any file is named.
 */
async function suggestedPackageNameFor(organizationId: string, case_: Case, mode: DataAdapterMode): Promise<PackageNameSuggestion | null> {
  try {
    const newestFirst = await listCaseSubmissionsNewestFirst(organizationId, case_.id, mode);
    const fromName = (fields: Partial<Record<string, string>> | null) =>
      fields?.decedentFirstName && fields.decedentLastName
        ? suggestPackageName({ first: fields.decedentFirstName, middle: fields.decedentMiddleName ?? case_.decedentMiddleName ?? null, last: fields.decedentLastName })
        : null;

    for (const submission of newestFirst) {
      let stored: Partial<Record<string, string>> | null = null;
      try {
        stored = JSON.parse(submission.mappedFields) as Partial<Record<string, string>>;
      } catch {
        stored = null;
      }
      const name = fromName(stored) ?? fromName(await structuredNameFromJotform(submission));
      if (name) return { name, source: 'form' };
    }

    const words = (case_.decedentName ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 2) {
      const name = suggestPackageName({ first: words[0], middle: case_.decedentMiddleName ?? null, last: words[1] });
      if (name) return { name, source: 'case_name' };
    }
    return null;
  } catch (error) {
    console.error('Could not look up a name for the package:', error instanceof Error ? error.message : error);
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

/** The pre-2026-10 name for the same name and date — see legacyCrematoryPackageFileName. */
function legacyFileName(facts: Facts): string | null {
  return legacyCrematoryPackageFileName(confirmedPackageName(facts.case_), facts.case_.crematory?.readyDate?.date ?? null);
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
      (facts.package.fileName === expectedFileName(facts) || facts.package.fileName === legacyFileName(facts)),
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
  packageName: { confirmed: PackageName | null; suggested: PackageName | null; suggestedFrom: PackageNameSuggestion['source'] | null };
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
    packageName: await (async () => {
      if (confirmedName) return { confirmed: confirmedName, suggested: null, suggestedFrom: null };
      const suggestion = await suggestedPackageNameFor(facts.case_.organizationId, facts.case_, mode);
      return { confirmed: null, suggested: suggestion?.name ?? null, suggestedFrom: suggestion?.source ?? null };
    })(),
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
  await prepareCrematoryDocuments(ctx, caseId, mode);
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
  await prepareCrematoryDocuments(ctx, caseId, mode);
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
  await prepareCrematoryDocuments(ctx, caseId, mode);
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

// ---------------------------------------------------------------------------
// Automatic preparation (2026-10)
// ---------------------------------------------------------------------------

export type AutoPrepareResult = {
  /** Page 3 of the Arrangement Form, saved as the Crematory Form. */
  crematoryForm: 'saved' | 'unchanged' | 'no_arrangement_form' | 'not_needed' | 'failed';
  /** The Crematory Package; `needs_attention` when something it needs is
      missing or unconfirmed — never built with a guess. */
  package: 'saved' | 'unchanged' | 'needs_attention' | 'not_needed' | 'failed';
};

const NOT_NEEDED: AutoPrepareResult = { crematoryForm: 'not_needed', package: 'not_needed' };
const preparing = new Map<string, Promise<AutoPrepareResult>>();
/** How long one server may hold a case's preparation before another may take over. */
const PREPARATION_LEASE_MS = 120_000;

/**
 * Prepares everything a case's Crematory Package is made from, using what
 * is already in the case's documents — called whenever one of its inputs
 * may have changed (an Arrangement Form or permit stored on the case, a
 * permit / name / date confirmed, workflow 2 completed, Send to Crematory
 * opened):
 *   1. page 3 of the latest Arrangement Form is saved as the Crematory
 *      Form — nothing new when that page is already saved, a new version
 *      when the Arrangement Form changed; the original is only read;
 *   2. the package is built when every requirement is met (the permit
 *      staff confirmed, page 3, workflow 2, the confirmed name and date) —
 *      nothing new when the saved package is still current, the next
 *      version when a source changed. Otherwise the case keeps showing what
 *      needs attention.
 * Never sends, and never touches a case already sent, being sent, or whose
 * send is unclear (a changed source never leads to a resend).
 *
 * One preparation per case at a time, across servers: when there is work
 * to do, a short lease is claimed on the case's crematory record with the
 * case's conditional write — two servers can never both hold it, so two
 * can never both save "the next version". A server that finds it held
 * waits for it, then checks again; the holder re-checks before releasing,
 * so a change that arrives meanwhile is never missed. Never throws.
 */
export function prepareCrematoryDocuments(
  ctx: ActivityContext,
  caseId: string,
  mode: DataAdapterMode,
  options: { waitMs?: number; pollMs?: number } = {},
): Promise<AutoPrepareResult> {
  if (!sendToCrematoryConfig(ctx.organizationId)) return Promise.resolve(NOT_NEEDED);
  const key = `${ctx.organizationId}:${caseId}`;
  const previous = preparing.get(key) ?? Promise.resolve(NOT_NEEDED);
  const run = previous
    .catch(() => NOT_NEEDED)
    .then(() => prepareWithLease(ctx, caseId, mode, options))
    .catch((error) => {
      console.error(`[crematory-auto] Case ${caseId}: preparation failed:`, error instanceof Error ? error.message : error);
      return { crematoryForm: 'failed', package: 'failed' } as AutoPrepareResult;
    });
  preparing.set(key, run);
  void run.finally(() => {
    if (preparing.get(key) === run) preparing.delete(key);
  });
  return run;
}

type Work = { page3: boolean; build: boolean };

/** What preparation would do now — read-only. Null: never for this case. */
async function pendingWork(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<Work | null> {
  const case_ = await loadCase(organizationId, caseId, mode).catch(() => null);
  if (!case_) return null;
  const record = case_.crematory;
  const sentOrSending = Boolean(record?.pendingSubmission) || record?.lastSubmission?.status === 'submitted' || record?.lastSubmission?.status === 'uncertain';
  if (case_.caseType !== 'cremation' || case_.isDeleted || sentOrSending) return null;
  const facts = await loadFacts(organizationId, case_, mode);
  const page3 = facts.arrangementForm !== null && (facts.crematoryForm === null || facts.crematoryForm.createdAt < facts.arrangementForm.createdAt);
  const build = readinessOf(facts, false).readyToBuild && !packageIsCurrent(facts);
  return { page3, build };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function prepareWithLease(ctx: ActivityContext, caseId: string, mode: DataAdapterMode, options: { waitMs?: number; pollMs?: number }): Promise<AutoPrepareResult> {
  const first = await pendingWork(ctx.organizationId, caseId, mode);
  if (!first) return NOT_NEEDED;
  if (!first.page3 && !first.build) return quietResult(ctx.organizationId, caseId, mode);

  const token = crypto.randomUUID();
  const deadline = Date.now() + (options.waitMs ?? 30_000);
  while (!(await claimPreparation(ctx.organizationId, caseId, token, mode))) {
    if (Date.now() >= deadline) {
      console.warn(`[crematory-auto] Case ${caseId}: another server is still preparing it; left to that server.`);
      return { crematoryForm: 'unchanged', package: 'unchanged' };
    }
    await sleep(options.pollMs ?? 1_000);
  }
  try {
    const result: AutoPrepareResult = { crematoryForm: 'unchanged', package: 'unchanged' };
    // Up to three passes: a change that lands while this one works is picked up before the lease is released.
    for (let pass = 0; pass < 3; pass++) {
      const work = await pendingWork(ctx.organizationId, caseId, mode);
      if (!work || (!work.page3 && !work.build)) break;
      const done = await prepareOnce(ctx, caseId, mode);
      if (done.crematoryForm === 'saved' || pass === 0) result.crematoryForm = done.crematoryForm;
      if (done.package === 'saved' || pass === 0) result.package = done.package;
      if (done.crematoryForm === 'failed' || done.package === 'failed') break;
    }
    return result;
  } finally {
    await applyCrematoryRecord(ctx.organizationId, caseId, (c) => (c.crematory?.preparing?.token === token ? { preparing: null } : null), mode).catch((error) =>
      console.error(`[crematory-auto] Case ${caseId}: could not release the preparation lease (it expires on its own):`, error instanceof Error ? error.message : error),
    );
  }
}

/** Claims the case's preparation lease — atomically, through the case's conditional write. */
async function claimPreparation(organizationId: string, caseId: string, token: string, mode: DataAdapterMode): Promise<boolean> {
  try {
    await applyCrematoryRecord(
      organizationId,
      caseId,
      (c) => {
        const held = c.crematory?.preparing;
        if (held && held.token !== token && Date.parse(held.until) > Date.now()) throw new CrematoryError('Being prepared by another server.', 423);
        return { preparing: { token, until: new Date(Date.now() + PREPARATION_LEASE_MS).toISOString() } };
      },
      mode,
    );
    return true;
  } catch (error) {
    if (error instanceof CrematoryError && (error.status === 423 || error.status === 409)) return false;
    throw error;
  }
}

/** Nothing to do: report the case as it stands. */
async function quietResult(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<AutoPrepareResult> {
  const facts = await loadFacts(organizationId, await loadCase(organizationId, caseId, mode), mode);
  return {
    crematoryForm: facts.arrangementForm ? 'unchanged' : 'no_arrangement_form',
    package: readinessOf(facts, false).readyToBuild ? 'unchanged' : 'needs_attention',
  };
}

async function prepareOnce(ctx: ActivityContext, caseId: string, mode: DataAdapterMode): Promise<AutoPrepareResult> {
  const result: AutoPrepareResult = { crematoryForm: 'no_arrangement_form', package: 'needs_attention' };
  try {
    result.crematoryForm = (await extractArrangementPage('crematory_form', caseId, { automatic: true }, ctx, mode)).outcome;
  } catch (error) {
    result.crematoryForm = error instanceof ArrangementExtractError && error.status === 422 ? 'no_arrangement_form' : 'failed';
    if (result.crematoryForm === 'failed') console.error(`[crematory-auto] Case ${caseId}: page 3 could not be prepared:`, error instanceof Error ? error.message : error);
  }
  try {
    const facts = await loadFacts(ctx.organizationId, await loadCase(ctx.organizationId, caseId, mode), mode);
    if (readinessOf(facts, false).readyToBuild) result.package = (await buildCrematoryPackage(ctx, caseId, mode)).outcome;
  } catch (error) {
    result.package = error instanceof CrematoryError && (error.status === 409 || error.status === 422) ? 'needs_attention' : 'failed';
    if (result.package === 'failed') console.error(`[crematory-auto] Case ${caseId}: the package could not be prepared:`, error instanceof Error ? error.message : error);
  }
  return result;
}

/** For the send service: the case, its readiness and its package. */
export async function loadForSending(organizationId: string, caseId: string, mode: DataAdapterMode) {
  const case_ = await loadCase(organizationId, caseId, mode);
  const facts = await loadFacts(organizationId, case_, mode);
  return { case_, facts, readiness: readinessOf(facts, true), summary: await summarize(facts, true, mode) };
}
