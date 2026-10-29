import crypto from 'crypto';
import type { DataAdapterMode } from '@/lib/env';
import type { Case, CaseCrematoryRecord, CaseUpdate } from '@/types/case';
import type { CaseDocument } from '@/types/caseDocument';
import type { ActivityContext } from '../activityService';
import { recordCrematoryEvent } from '../activityService';
import { ACTIVITY_EVENT_TYPES } from '@/types/activityEvent';
import {
  assignUntypedDocumentType,
  DocumentServiceError,
  generateBillingDocument,
  list as listCaseDocuments,
  readStoredCaseDocument,
  attachDocumentActorDisplayNames,
  supersedeCaseDocument,
  upload as uploadCaseDocument,
} from '../documentService';
import { loadCaseOnServer } from '../serverCaseLoader';
import { listForOrganization } from '../casesService';
import { updateCaseWithRetry, writeMockCase } from '../caseWriteService';
import { buildCaseFieldPatch } from '@/lib/wixCaseMapper';
import { getAppointment } from '../scheduling/appointmentReads';
import { expectedPickupAppointmentId } from '../cremainsPickupService';
import { expectedDateOf } from '@/domain/scheduling/cremainsPickupPresentation';
import { getOrganization } from '../organizationProvisioningService';
import { DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';
import { ARRANGEMENT_EXTRACTS, ARRANGEMENT_FORMS_DOCUMENT_TYPE_KEY, visibleItems, workflowStageComplete } from '@/domain/documents/arrangementPageExtracts';
import { presentedChecklistLabel } from '@/domain/organization/checklistRelabel';
import { checklistItemsForEvent } from '@/domain/sla/slaMilestones';
import { checklistItemKey } from '@/domain/workflow/checklistItemKey';
import { previousSendMethodLabel, validateCorrectionReason, validatePreviousSend, type PreviousSendInput } from '@/domain/crematory/previousSend';
import {
  crematoryPackageFileName,
  legacyCrematoryPackageFileName,
  normalizePackageName,
  packageDisplayName,
  parseCaseDate,
  reliablePackageName,
  suggestPackageName,
  suggestSourceKind,
  toCaseDate,
  type CrematorySourceKind,
  type PackageName,
  type StructuredDecedentName,
  type UntypedCaseDocument,
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
  /** Every current (active) state permit — more than one is a conflict. */
  currentPermits: CaseDocument[];
  arrangementForm: CaseDocument | null;
  crematoryForm: CaseDocument | null;
  package: CaseDocument | null;
  suggestedReadyDate: string | null;
  /** Active, untyped PDFs on the case — what staff may choose as a source document. */
  untyped: CaseDocument[];
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

/** The decedent's name as each intake form structured it — first /
    middle / last boxes kept on the submission or, for submissions received
    before those were kept, read back from Jotform (read-only) — newest
    first. */
async function structuredNamesFor(organizationId: string, case_: Case, mode: DataAdapterMode): Promise<StructuredDecedentName[]> {
  const toName = (fields: Partial<Record<string, string>> | null): StructuredDecedentName | null =>
    fields?.decedentFirstName?.trim() && fields.decedentLastName?.trim()
      ? { first: fields.decedentFirstName, middle: fields.decedentMiddleName?.trim() ? fields.decedentMiddleName : null, last: fields.decedentLastName }
      : null;
  const names: StructuredDecedentName[] = [];
  for (const submission of await listCaseSubmissionsNewestFirst(organizationId, case_.id, mode)) {
    let stored: Partial<Record<string, string>> | null = null;
    try {
      stored = JSON.parse(submission.mappedFields) as Partial<Record<string, string>>;
    } catch {
      stored = null;
    }
    const name = toName(stored) ?? toName(await structuredNameFromJotform(submission));
    if (name) names.push(name);
  }
  return names;
}

/**
 * Fills in the package name for staff to confirm (2026-10), from the most
 * reliable source available:
 *   1. the decedent's name as an intake form structured it — the first /
 *      middle / last boxes (see structuredNamesFor);
 *   2. otherwise a case name of exactly two words ("RICHARD REYNOLDS") —
 *      only ever a suggestion for staff to check, never recorded on its own;
 *   3. otherwise nothing: a longer name ("MARY ANN SMITH") cannot say which
 *      words are the surname, so staff type it.
 */
async function suggestedPackageNameFor(organizationId: string, case_: Case, mode: DataAdapterMode): Promise<PackageNameSuggestion | null> {
  try {
    const [newest] = await structuredNamesFor(organizationId, case_, mode);
    if (newest) {
      const name = suggestPackageName({ first: newest.first, middle: newest.middle ?? case_.decedentMiddleName ?? null, last: newest.last });
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

/**
 * The name and expected ready date SOLIS may record on its own (2026-10),
 * where staff have not — null for each when there is nothing reliable to
 * record or nothing to change:
 *   - the name only from the intake forms' own name boxes, agreeing with
 *     each other and with the case's name (reliablePackageName), and never
 *     over a name already recorded — a staff confirmation or correction is
 *     kept as it is;
 *   - the date only from a valid, scheduled (not cancelled) Expected
 *     Pickup — and, for a date recorded that way, again whenever the pickup
 *     moves. A date staff entered or confirmed is never changed; if the
 *     pickup moves after it, the case needs attention instead.
 */
async function automaticDetails(organizationId: string, case_: Case, mode: DataAdapterMode): Promise<{ name: PackageName | null; date: string | null }> {
  const record = case_.crematory;
  let name: PackageName | null = null;
  if (!record?.packageName) {
    try {
      name = reliablePackageName(case_, await structuredNamesFor(organizationId, case_, mode));
    } catch (error) {
      console.error(`[crematory-auto] Case ${case_.id}: could not read the intake form name:`, error instanceof Error ? error.message : error);
    }
  }
  const suggested = await suggestedReadyDate(organizationId, case_.id, mode);
  const current = record?.readyDate;
  const followsPickup = !current || (current.source === 'expected_pickup' && (current.date !== suggested || current.suggestedAtConfirmation !== suggested));
  const date = suggested && parseCaseDate(suggested) && followsPickup ? suggested : null;
  return { name, date };
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
    currentPermits: documents.filter((d) => d.status === 'active' && d.documentTypeKey === PERMIT_TYPE),
    arrangementForm: latest(documents, (d) => d.documentTypeKey === ARRANGEMENT_FORMS_DOCUMENT_TYPE_KEY && d.mimeType === 'application/pdf'),
    crematoryForm: latest(documents, (d) => d.documentTypeKey === ARRANGEMENT_EXTRACTS.crematory_form.documentTypeKey && d.origin === 'generated'),
    package: latest(documents, (d) => d.documentTypeKey === PACKAGE_TYPE && d.origin === 'generated'),
    suggestedReadyDate: await suggestedReadyDate(organizationId, case_.id, mode),
    untyped: documents.filter((d) => d.status === 'active' && d.mimeType === 'application/pdf' && !d.documentTypeKey).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
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

/** Workflow 2 as the case shows it (2026-10): the stage, whether this is a
    Medical Examiner case, and the steps not yet checked — the ME
    verification steps on an ME case, never the doctor steps it replaces. */
function workflow2Of(case_: Case): { displayStage: number; medicalExaminer: boolean; missing: string[] } | null {
  const config = sendToCrematoryConfig(case_.organizationId);
  if (!config) return null;
  const stage = config.authorizationWorkflowStage;
  const items = visibleItems(case_, stage);
  if (items.length === 0) return null;
  return {
    displayStage: stage,
    medicalExaminer: case_.isMedicalExaminerCase === true,
    missing: items.filter((item) => case_.checklistState?.[checklistItemKey(stage, item.index)] !== true).map((item) => presentedChecklistLabel(case_.organizationId, stage, item)),
  };
}

/** Workflow 3's "Permit sent to crematory" is checked (2026-10). A checked
    step is staff's own note — it never proves an email went out. */
function permitSentChecked(case_: Case): boolean {
  const items = checklistItemsForEvent(case_, 'permit_sent');
  return items.length > 0 && items.every((item) => case_.checklistState?.[checklistItemKey(item.displayStage, item.index)] === true);
}

/** Whether SOLIS has a send of its own for the case (sent, or possibly sent). */
function solisSendOnRecord(case_: Case): boolean {
  const status = case_.crematory?.lastSubmission?.status;
  return status === 'submitted' || status === 'uncertain' || Boolean(case_.crematory?.pendingSubmission);
}

function readinessOf(facts: Facts, canSend: boolean): CrematoryReadiness {
  const config = sendToCrematoryConfig(facts.case_.organizationId);
  const record = facts.case_.crematory ?? {};
  return evaluateCrematoryReadiness({
    caseType: facts.case_.caseType,
    isArchived: facts.case_.isDeleted === true,
    sentAt: facts.case_.crematory?.lastSubmission?.status === 'submitted' ? facts.case_.crematory.lastSubmission.at : null,
    workflow2Complete: config ? workflowStageComplete(facts.case_, config.authorizationWorkflowStage) : null,
    workflow2Missing: workflow2Of(facts.case_)?.missing ?? [],
    medicalExaminerCase: facts.case_.isMedicalExaminerCase === true,
    previousSend: {
      indicated: permitSentChecked(facts.case_) && !solisSendOnRecord(facts.case_),
      recorded: record.previousSend
        ? { decision: record.previousSend.decision, method: previousSendMethodLabel(record.previousSend.method), sentOn: record.previousSend.sentOn }
        : null,
    },
    permit: facts.permit ? { documentId: facts.permit.id, checksumSha256: facts.permit.checksumSha256, mimeType: facts.permit.mimeType } : null,
    currentPermitCount: facts.currentPermits.length,
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
  packageName: {
    confirmed: PackageName | null;
    suggested: PackageName | null;
    suggestedFrom: PackageNameSuggestion['source'] | null;
    /** Who recorded the name (2026-10): staff, or SOLIS from the intake form. */
    recordedFrom: 'staff' | 'intake_form' | null;
  };
  /** "First Last" from the confirmed package name, for the subject. */
  subjectName: string;
  readiness: CrematoryReadiness;
  permit: { documentId: string; fileName: string; createdAt: string; uploadedBy: string | null; checksumSha256: string; version: number | null } | null;
  /** `confirmed`: the date recorded — by staff, or from the Expected Pickup (2026-10). */
  readyDate: { suggested: string | null; confirmed: string | null; recordedFrom: 'staff' | 'expected_pickup' | null };
  package: { documentId: string; version: number | null; fileName: string; current: boolean } | null;
  expectedFileName: string | null;
  lastSubmission: CaseCrematoryRecord['lastSubmission'] | null;
  untypedDocuments: UntypedCaseDocument[];
  /** Workflow 2 as the case shows it, with the steps not yet checked (2026-10). */
  workflow2: { displayStage: number; medicalExaminer: boolean; missing: string[] } | null;
  /** A possible earlier send outside SOLIS (2026-10): flagged while
      unresolved, and what staff recorded. */
  previousSend: { indicated: boolean; recorded: CaseCrematoryRecord['previousSend'] | null };
};

async function summarize(facts: Facts, canSend: boolean, mode: DataAdapterMode): Promise<CrematoryCaseSummary> {
  const [permitWithName] = facts.permit ? await attachDocumentActorDisplayNames([facts.permit], mode) : [null];
  const confirmedName = confirmedPackageName(facts.case_);
  return {
    caseId: facts.case_.id,
    caseNumber: facts.case_.caseNumber,
    decedentDisplayName: decedentDisplayName(facts.case_),
    packageName: await (async () => {
      if (confirmedName) return { confirmed: confirmedName, suggested: null, suggestedFrom: null, recordedFrom: facts.case_.crematory?.packageName?.source ?? 'staff' };
      const suggestion = await suggestedPackageNameFor(facts.case_.organizationId, facts.case_, mode);
      return { confirmed: null, suggested: suggestion?.name ?? null, suggestedFrom: suggestion?.source ?? null, recordedFrom: null };
    })(),
    subjectName: confirmedName ? packageDisplayName(confirmedName) : decedentDisplayName(facts.case_),
    readiness: readinessOf(facts, canSend),
    permit: permitWithName
      ? { documentId: permitWithName.id, fileName: permitWithName.fileName, createdAt: permitWithName.createdAt, uploadedBy: permitWithName.actorDisplayName, checksumSha256: permitWithName.checksumSha256, version: permitWithName.version ?? null }
      : null,
    readyDate: {
      suggested: facts.suggestedReadyDate,
      confirmed: facts.case_.crematory?.readyDate?.date ?? null,
      recordedFrom: facts.case_.crematory?.readyDate ? (facts.case_.crematory.readyDate.source ?? 'staff') : null,
    },
    package: facts.package ? { documentId: facts.package.id, version: facts.package.version, fileName: facts.package.fileName, current: packageIsCurrent(facts) } : null,
    expectedFileName: expectedFileName(facts),
    lastSubmission: facts.case_.crematory?.lastSubmission ?? null,
    untypedDocuments: facts.untyped.map((d) => ({ documentId: d.id, fileName: d.fileName, createdAt: d.createdAt, suggestedAs: suggestSourceKind(d.fileName), checksumSha256: d.checksumSha256 })),
    workflow2: workflow2Of(facts.case_),
    previousSend: {
      indicated: permitSentChecked(facts.case_) && !solisSendOnRecord(facts.case_) && !facts.case_.crematory?.previousSend,
      recorded: facts.case_.crematory?.previousSend ?? null,
    },
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

/** Sent, being sent, or with a send Outlook left unclear (2026-10): its
    permit, name, date and Crematory Package are never changed again. */
export function isSentOrSending(case_: Case): boolean {
  const record = case_.crematory;
  return Boolean(record?.pendingSubmission) || record?.lastSubmission?.status === 'submitted' || record?.lastSubmission?.status === 'uncertain';
}

const SENT_MESSAGE = 'This case was already sent (or is being sent) to the crematory, so its permit, name, date and Crematory Package are not changed here.';
function refuseSent(case_: Case, message = SENT_MESSAGE) {
  if (isSentOrSending(case_)) throw new CrematoryError(message, 409);
}

async function audit(ctx: ActivityContext, caseId: string, eventType: Parameters<typeof recordCrematoryEvent>[2], details: Parameters<typeof recordCrematoryEvent>[3], mode: DataAdapterMode) {
  try {
    await recordCrematoryEvent(ctx, caseId, eventType, details, mode);
  } catch (error) {
    console.error(`Failed to record ${eventType}:`, error instanceof Error ? error.message : error);
  }
}

/** What a staff member was shown before confirming or choosing a permit
    (2026-10): the document, and the checksum of the stored PDF SOLIS
    displayed to them — so a confirmation is always of the exact file seen. */
export type DisplayedPermit = { documentId: string; displayedChecksumSha256: string | null | undefined };

const NOT_DISPLAYED = 'Open the permit in SOLIS and check it before confirming. Nothing was confirmed.';

/** Staff confirm the uploaded permit (that exact file — the one shown to
    them in SOLIS, by checksum) is the approved state permit for this
    decedent. Recorded with its document, version and checksum. */
export async function confirmPermit(ctx: ActivityContext, caseId: string, displayed: DisplayedPermit, mode: DataAdapterMode, canSend = false): Promise<CrematoryCaseSummary> {
  const { documentId } = displayed;
  assertSendToCrematoryEnabled(ctx.organizationId);
  const case_ = await loadCase(ctx.organizationId, caseId, mode);
  refuseArchived(case_);
  refuseSent(case_);
  const facts = await loadFacts(ctx.organizationId, case_, mode);
  if (facts.currentPermits.length > 1) throw new CrematoryError('This case has more than one current state permit. Choose the one to use first.', 409);
  if (!facts.permit || facts.permit.id !== documentId) throw new CrematoryError('That is not the latest state permit uploaded to this case. Reopen and try again.', 409);
  if (facts.permit.mimeType !== 'application/pdf') throw new CrematoryError('The state permit must be a PDF to be included in the Crematory Package.', 422);
  if (!displayed.displayedChecksumSha256) throw new CrematoryError(NOT_DISPLAYED, 400);
  if (displayed.displayedChecksumSha256 !== facts.permit.checksumSha256) {
    throw new CrematoryError('The permit shown is not the stored permit on this case. Reopen it and check it again. Nothing was confirmed.', 409);
  }
  const verifiedAt = new Date().toISOString();
  const version = facts.permit.version ?? null;
  await applyCrematoryRecord(
    ctx.organizationId,
    caseId,
    (current) => (
      refuseArchived(current),
      refuseSent(current),
      { permitVerification: { documentId, checksumSha256: facts.permit!.checksumSha256, version, displayedInSolis: true, verifiedBy: ctx.actorIdentityId, verifiedAt } }
    ),
    mode,
  );
  await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_PERMIT_CONFIRMED, {
    resourceId: documentId,
    description: `State permit "${facts.permit.fileName}"${version ? ` (v${version})` : ''} shown in SOLIS and confirmed as the approved permit for ${decedentDisplayName(case_)}`,
    record: { documentId, version, checksumSha256: facts.permit.checksumSha256, displayedInSolis: true },
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
  refuseSent(case_);
  const suggested = await suggestedReadyDate(ctx.organizationId, caseId, mode);
  const previous = case_.crematory?.readyDate?.date ?? null;
  await applyCrematoryRecord(
    ctx.organizationId,
    caseId,
    (current) => (refuseArchived(current), refuseSent(current), { readyDate: { date: confirmed, suggestedAtConfirmation: suggested, confirmedBy: ctx.actorIdentityId, confirmedAt: new Date().toISOString(), source: 'staff' } }),
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
  refuseSent(case_);
  const previous = confirmedPackageName(case_);
  await applyCrematoryRecord(
    ctx.organizationId,
    caseId,
    (current) => (refuseArchived(current), refuseSent(current), { packageName: { ...name, confirmedBy: ctx.actorIdentityId, confirmedAt: new Date().toISOString(), source: 'staff' } }),
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
  refuseArchived(case_);
  // A sent package is never superseded by a rebuild (2026-10).
  refuseSent(case_);
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

const SOURCE_TYPES: Record<CrematorySourceKind, { documentTypeKey: string; displayName: string }> = {
  state_permit: { documentTypeKey: PERMIT_TYPE, displayName: DOCUMENT_TYPES.CREMATION_FORM_STATE_PERMIT.displayName },
  arrangement_forms: { documentTypeKey: ARRANGEMENT_FORMS_DOCUMENT_TYPE_KEY, displayName: DOCUMENT_TYPES.EXTERNAL_FORM_ARRANGEMENT_FORMS.displayName },
};

/**
 * Staff choose a PDF already uploaded to the case, without a type, as its
 * state permit or Arrangement Form (2026-10) — so nothing is uploaded
 * twice. Only that document's type is set (file, storage, version and
 * every other field unchanged), recorded in the case activity. Refused,
 * nothing written: a case sent, being sent or with an unclear send; a
 * document that is not this case's own active, untyped PDF; or a case that
 * already has a document of that type. Serialized per case with automatic
 * preparation, across servers. Afterwards an Arrangement Form has its page
 * 3 prepared at once; a permit still needs staff to confirm it is this
 * decedent's.
 */
export async function assignSourceDocument(
  ctx: ActivityContext,
  caseId: string,
  documentId: string,
  as: CrematorySourceKind,
  mode: DataAdapterMode,
  canSend = false,
  /** A permit is chosen only after SOLIS showed staff that exact PDF (2026-10). */
  displayedChecksumSha256?: string | null,
): Promise<CrematoryCaseSummary> {
  assertSendToCrematoryEnabled(ctx.organizationId);
  const target = SOURCE_TYPES[as];
  if (as === 'state_permit' && !displayedChecksumSha256) throw new CrematoryError('Open the PDF in SOLIS and check it before choosing it as the permit. Nothing was changed.', 400);
  if (!target) throw new CrematoryError('Choose the permit or the Arrangement Form.', 400);
  const case_ = await loadCase(ctx.organizationId, caseId, mode);
  refuseArchived(case_);
  refuseSent(case_, DOCUMENTS_SENT_MESSAGE);

  const assigned = await withPreparationLease(ctx.organizationId, caseId, mode, DOCUMENTS_SENT_MESSAGE, async () => {
    const documents = await listCaseDocuments(ctx.organizationId, caseId, mode);
    const existing = latest(documents, (d) => d.documentTypeKey === target.documentTypeKey);
    if (existing) throw new CrematoryError(`This case already has a ${target.displayName}: "${existing.fileName}".`, 409);
    if (as === 'state_permit' && documents.find((d) => d.id === documentId)?.checksumSha256 !== displayedChecksumSha256) {
      throw new CrematoryError('The PDF shown is not that document. Reopen it and check it again. Nothing was changed.', 409);
    }
    try {
      return await assignUntypedDocumentType(ctx.organizationId, caseId, documentId, target.documentTypeKey, mode);
    } catch (error) {
      if (error instanceof DocumentServiceError) throw new CrematoryError(`${error.message} Reopen and choose again.`, 409);
      throw error;
    }
  });
  await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_DOCUMENT_TYPE_ASSIGNED, {
    resourceId: assigned.id,
    description: `"${assigned.fileName}" chosen as the ${target.displayName} (document type set; the file is unchanged)`,
    record: { documentId: assigned.id, documentTypeKey: target.documentTypeKey, previousDocumentTypeKey: null },
  }, mode);
  if (as === 'arrangement_forms') await prepareCrematoryDocuments(ctx, caseId, mode);
  return getCrematoryCaseSummary(ctx.organizationId, caseId, canSend, mode);
}

const DOCUMENTS_SENT_MESSAGE = 'This case was already sent (or is being sent) to the crematory, so its documents are not changed here.';

/**
 * Runs `work` holding the case's preparation lease (2026-10) — the same
 * one automatic preparation takes — so it never runs alongside a
 * preparation, another permit change, or a send, on any server. Waits up
 * to 30 seconds for it; refused, nothing done, once the case is sent or
 * being sent.
 */
async function withPreparationLease<T>(organizationId: string, caseId: string, mode: DataAdapterMode, sentMessage: string, work: () => Promise<T>): Promise<T> {
  const token = crypto.randomUUID();
  const deadline = Date.now() + 30_000;
  for (;;) {
    const claim = await claimPreparation(organizationId, caseId, token, mode);
    if (claim === 'claimed') break;
    if (claim === 'closed') throw new CrematoryError(sentMessage, 409);
    if (Date.now() >= deadline) throw new CrematoryError('This case is being updated right now. Try again in a moment.', 409);
    await sleep(1_000);
  }
  try {
    return await work();
  } finally {
    await applyCrematoryRecord(organizationId, caseId, (c) => (c.crematory?.preparing?.token === token ? { preparing: null } : null), mode).catch(() => undefined);
  }
}

/** Staff build or rebuild the package themselves — serialized with preparation and sending. */
export async function buildCrematoryPackageNow(ctx: ActivityContext, caseId: string, mode: DataAdapterMode, canSend = false): Promise<BuildOutcome> {
  assertSendToCrematoryEnabled(ctx.organizationId);
  return withPreparationLease(ctx.organizationId, caseId, mode, SENT_MESSAGE, () => buildCrematoryPackage(ctx, caseId, mode, canSend));
}

/**
 * Staff record what happened to a case Workflow 3 marks "Permit sent to
 * crematory" while SOLIS has no send of its own (2026-10) — once, with the
 * method and date if it was sent outside SOLIS, or an explicit
 * confirmation that they checked and it was not, and in both cases how
 * they verified it. Recorded in the case activity.
 *   - sent outside SOLIS: the case is never sent through the first send;
 *   - not previously sent: the warning is resolved and the case can be
 *     sent as usual (every other check still applies).
 * Refused — nothing recorded — when the case does not show a possible
 * earlier send, SOLIS already sent it (or is sending it), or a decision is
 * already recorded. Never changes the workflow checklist.
 */
export async function recordPreviousSend(ctx: ActivityContext, caseId: string, input: PreviousSendInput, mode: DataAdapterMode, canSend = false): Promise<CrematoryCaseSummary> {
  assertSendToCrematoryEnabled(ctx.organizationId);
  const case_ = await loadCase(ctx.organizationId, caseId, mode);
  refuseArchived(case_);
  // Today in UTC — never behind the organization's own date in the Americas.
  const now = new Date();
  const today = `${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}/${now.getUTCFullYear()}`;
  const valid = validatePreviousSend(input, today);
  if ('error' in valid) throw new CrematoryError(valid.error, 422);
  const refusal = (c: Case) => {
    if (solisSendOnRecord(c)) throw new CrematoryError('SOLIS already has a send for this case, so there is nothing to record here.', 409);
    if (c.crematory?.previousSend) throw new CrematoryError('What happened to the earlier send is already recorded for this case.', 409);
    if (!permitSentChecked(c)) throw new CrematoryError('This case does not show a possible earlier send to the crematory.', 409);
  };
  refusal(case_);
  const recordedAt = new Date().toISOString();
  await applyCrematoryRecord(
    ctx.organizationId,
    caseId,
    (current) => (refuseArchived(current), refusal(current), { previousSend: { ...valid, recordedBy: ctx.actorIdentityId, recordedAt } }),
    mode,
  );
  const method = previousSendMethodLabel(valid.method);
  await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_PREVIOUS_SEND_RECORDED, {
    resourceId: null,
    description:
      valid.decision === 'sent_outside_solis'
        ? `Recorded as already sent to the crematory outside SOLIS (${[method, valid.sentOn ?? 'date unknown'].join(', ')}) — not sent again through the first send. Verified: ${valid.verification}`
        : `Recorded as NOT previously sent to the crematory, after checking the sending records. Checked: ${valid.verification}`,
    record: { decision: valid.decision, method: valid.method, sentOn: valid.sentOn, verification: valid.verification, verifiedBy: ctx.actorIdentityId, verifiedAt: recordedAt },
  }, mode);
  return getCrematoryCaseSummary(ctx.organizationId, caseId, canSend, mode);
}

/**
 * An administrator corrects a recorded answer about a possible earlier
 * send (2026-10): a written reason, and the corrected answer with the same
 * fields and checks as the original. Every earlier answer is kept on the
 * case, each with its own correction, and the change is recorded in the
 * case activity (who, when, before, after, why). The latest answer is the
 * one readiness uses. Refused — nothing changed — while SOLIS is sending
 * the case or after it sent it (or may have), or when nothing is recorded.
 * Nothing is ever sent from here; corrected to "not previously sent", the
 * case is simply back in the first send, with every check still applying.
 * The caller checks the administrator permission.
 */
export async function correctPreviousSend(
  ctx: ActivityContext,
  caseId: string,
  input: PreviousSendInput & { reason?: unknown },
  mode: DataAdapterMode,
  canSend = false,
): Promise<CrematoryCaseSummary> {
  assertSendToCrematoryEnabled(ctx.organizationId);
  const case_ = await loadCase(ctx.organizationId, caseId, mode);
  refuseArchived(case_);
  const reason = validateCorrectionReason(input.reason);
  if (typeof reason !== 'string') throw new CrematoryError(reason.error, 422);
  const now = new Date();
  const today = `${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}/${now.getUTCFullYear()}`;
  const valid = validatePreviousSend(input, today);
  if ('error' in valid) throw new CrematoryError(valid.error, 422);
  const before = case_.crematory?.previousSend ?? null;
  const refusal = (c: Case) => {
    if (solisSendOnRecord(c)) throw new CrematoryError('SOLIS is sending, or has sent, this case — the earlier-send record is no longer corrected here.', 409);
    const current = c.crematory?.previousSend;
    if (!current) throw new CrematoryError('There is no earlier-send record on this case to correct.', 409);
    // Two corrections at once: the second sees the first and is refused.
    if (current.recordedAt !== before?.recordedAt) throw new CrematoryError('The earlier-send record changed while you were correcting it. Reopen and try again.', 409);
  };
  refusal(case_);
  const correctedAt = now.toISOString();
  await applyCrematoryRecord(
    ctx.organizationId,
    caseId,
    (current) => {
      refuseArchived(current);
      refusal(current);
      const { earlier = [], ...previous } = current.crematory!.previousSend!;
      return {
        previousSend: {
          ...valid,
          recordedBy: ctx.actorIdentityId,
          recordedAt: correctedAt,
          correction: { reason, correctedBy: ctx.actorIdentityId, correctedAt },
          earlier: [...earlier, previous],
        },
      };
    },
    mode,
  );
  const describe = (a: { decision: string; method: string | null; sentOn: string | null }) =>
    a.decision === 'sent_outside_solis' ? `sent outside SOLIS (${[previousSendMethodLabel(a.method), a.sentOn ?? 'date unknown'].filter(Boolean).join(', ')})` : 'not previously sent';
  await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_PREVIOUS_SEND_CORRECTED, {
    resourceId: null,
    description: `Earlier-send record corrected by an administrator: was "${describe(before!)}", now "${describe(valid)}". Reason: ${reason}`,
    record: {
      previous: { decision: before!.decision, method: before!.method, sentOn: before!.sentOn, verification: before!.verification, recordedBy: before!.recordedBy, recordedAt: before!.recordedAt },
      corrected: { decision: valid.decision, method: valid.method, sentOn: valid.sentOn, verification: valid.verification },
      reason,
      correctedBy: ctx.actorIdentityId,
      correctedAt,
    },
  }, mode);
  return getCrematoryCaseSummary(ctx.organizationId, caseId, canSend, mode);
}

// ---------------------------------------------------------------------------
// The state permit — one current permit per case (2026-10)
// ---------------------------------------------------------------------------

export type PermitFile = { fileName: string; mimeType: string; bytes: Buffer; category?: CaseDocument['category'] };
const PERMIT_SENT_MESSAGE =
  'This case was already sent (or is being sent) to the crematory, so its State Cremation Permit is not changed. To keep this file on the case, upload it without a document type.';

/**
 * Stores a state permit on the case — the one way a permit is uploaded for
 * an organization with Send to Crematory, from the Documents tab or from
 * Send to Crematory alike, so the case keeps ONE current permit and every
 * screen uses the same document:
 *   - the first permit is stored as version 1;
 *   - a replacement names the permit it replaces (so two people replacing
 *     at once can never both win), is limited to staff who prepare
 *     Crematory Packages, and is stored as the next version; the earlier
 *     permit is kept with its file and history, marked superseded, and its
 *     confirmation cleared (the confirmation stays in the case activity).
 *     The new one must be confirmed before any package uses it, so the
 *     current package is outdated until it is rebuilt from it;
 *   - refused, nothing stored: the same file already on the case; a second
 *     permit without saying which it replaces; a case with more than one
 *     current permit (staff choose first — never resolved automatically);
 *     and a case sent, being sent, or whose send is unclear.
 * If the upload fails nothing changes: the earlier permit stays current.
 */
export async function addPermit(
  ctx: ActivityContext,
  caseId: string,
  file: PermitFile,
  options: { replacesDocumentId?: string | null; mayReplace: boolean },
  mode: DataAdapterMode,
): Promise<{ document: CaseDocument; replaced: CaseDocument | null }> {
  assertSendToCrematoryEnabled(ctx.organizationId);
  const case_ = await loadCase(ctx.organizationId, caseId, mode);
  refuseArchived(case_);
  refuseSent(case_, PERMIT_SENT_MESSAGE);
  const replacesDocumentId = options.replacesDocumentId || null;
  if (replacesDocumentId && !options.mayReplace) throw new CrematoryError('Replacing the State Cremation Permit is limited to staff who prepare Crematory Packages.', 403);
  const checksum = sha256(file.bytes);

  const result = await withPreparationLease(ctx.organizationId, caseId, mode, PERMIT_SENT_MESSAGE, async () => {
    const active = (await listCaseDocuments(ctx.organizationId, caseId, mode)).filter((d) => d.status === 'active');
    const same = active.find((d) => d.checksumSha256 === checksum);
    if (same) {
      throw new CrematoryError(
        same.documentTypeKey === PERMIT_TYPE
          ? `This file is already this case's State Cremation Permit ("${same.fileName}"). Nothing was uploaded.`
          : same.documentTypeKey
            ? `This file is already on this case as "${same.fileName}". Nothing was uploaded.`
            : `This file is already on this case as "${same.fileName}". Choose it from this case's documents instead. Nothing was uploaded.`,
        409,
      );
    }
    const current = active.filter((d) => d.documentTypeKey === PERMIT_TYPE);
    if (current.length > 1) throw new CrematoryError(`This case has ${current.length} current state permits. Choose the one to use before adding another. Nothing was uploaded.`, 409);
    const previous = current[0] ?? null;
    if (previous && replacesDocumentId !== previous.id) {
      throw new CrematoryError(
        replacesDocumentId
          ? 'The permit you are replacing is no longer the current one. Reopen and try again. Nothing was uploaded.'
          : `This case already has a State Cremation Permit ("${previous.fileName}"). Use Replace permit instead of adding a second one. Nothing was uploaded.`,
        409,
      );
    }
    if (!previous && replacesDocumentId) throw new CrematoryError('The permit you are replacing is no longer the current one. Reopen and try again. Nothing was uploaded.', 409);

    let document: CaseDocument;
    try {
      document = await uploadCaseDocument(
        {
          caseId,
          fileName: file.fileName,
          mimeType: file.mimeType,
          documentTypeKey: PERMIT_TYPE,
          category: file.category ?? undefined,
          idFactory: () => crypto.randomUUID(),
          version: previous ? (previous.version ?? 1) + 1 : 1,
          supersedesId: previous?.id ?? null,
        },
        file.bytes,
        ctx,
        mode,
      );
    } catch (error) {
      if (error instanceof DocumentServiceError) throw new CrematoryError(`${error.message} Nothing was saved as the permit.`, 503);
      throw error;
    }
    if (previous) {
      try {
        await supersedeCaseDocument(ctx.organizationId, caseId, previous.id, mode);
      } catch (error) {
        console.error(`Case ${caseId}: permit ${previous.id} could not be marked superseded:`, error instanceof Error ? error.message : error);
        // Both stay current — a conflict nothing is ever sent with until staff choose.
        throw new CrematoryError(`The new permit "${document.fileName}" was saved, but "${previous.fileName}" could not be marked as replaced. Both are kept; choose the current one before sending.`, 503);
      }
      // The earlier permit's confirmation no longer applies (a stale one
      // could never match the new file anyway — this makes it explicit).
      await applyCrematoryRecord(ctx.organizationId, caseId, (c) => (c.crematory?.permitVerification ? { permitVerification: null } : null), mode);
    }
    return { document, replaced: previous };
  });

  const { document, replaced } = result;
  await audit(ctx, caseId, replaced ? ACTIVITY_EVENT_TYPES.CREMATORY_PERMIT_REPLACED : ACTIVITY_EVENT_TYPES.CREMATORY_PERMIT_ADDED, {
    resourceId: document.id,
    description: replaced
      ? `State Cremation Permit replaced: "${document.fileName}" (v${document.version}) replaces "${replaced.fileName}", which is kept as an earlier version. It must be confirmed before a package uses it.`
      : `State Cremation Permit added: "${document.fileName}". It must be confirmed before a package uses it.`,
    record: { documentId: document.id, fileName: document.fileName, checksumSha256: document.checksumSha256, version: document.version, replacedDocumentId: replaced?.id ?? null },
  }, mode);
  return result;
}

/**
 * Where a case has more than one current state permit (only ever from
 * before 2026-10), staff choose the one to use. The others are kept with
 * their files and history, marked superseded. Never done automatically.
 */
export async function chooseCurrentPermit(ctx: ActivityContext, caseId: string, documentId: string, mode: DataAdapterMode, canSend = false): Promise<CrematoryCaseSummary> {
  assertSendToCrematoryEnabled(ctx.organizationId);
  const case_ = await loadCase(ctx.organizationId, caseId, mode);
  refuseArchived(case_);
  refuseSent(case_, PERMIT_SENT_MESSAGE);
  const { chosen, others } = await withPreparationLease(ctx.organizationId, caseId, mode, PERMIT_SENT_MESSAGE, async () => {
    const current = (await listCaseDocuments(ctx.organizationId, caseId, mode)).filter((d) => d.status === 'active' && d.documentTypeKey === PERMIT_TYPE);
    if (current.length < 2) throw new CrematoryError('This case has only one current state permit. Reopen and try again.', 409);
    const chosen = current.find((d) => d.id === documentId);
    if (!chosen) throw new CrematoryError("That is not one of this case's current state permits. Reopen and try again.", 409);
    const others = current.filter((d) => d.id !== documentId);
    for (const other of others) await supersedeCaseDocument(ctx.organizationId, caseId, other.id, mode);
    return { chosen, others };
  });
  await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_CURRENT_PERMIT_CHOSEN, {
    resourceId: chosen.id,
    description: `"${chosen.fileName}" chosen as the current State Cremation Permit; ${others.map((d) => `"${d.fileName}"`).join(', ')} kept as earlier versions`,
    record: { documentId: chosen.id, supersededDocumentIds: others.map((d) => d.id) },
  }, mode);
  await prepareCrematoryDocuments(ctx, caseId, mode);
  return getCrematoryCaseSummary(ctx.organizationId, caseId, canSend, mode);
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

type Work = { page3: boolean; build: boolean; details: boolean };

/** What preparation would do now — read-only. Null: never for this case. */
async function pendingWork(organizationId: string, caseId: string, mode: DataAdapterMode): Promise<Work | null> {
  const case_ = await loadCase(organizationId, caseId, mode).catch(() => null);
  if (!case_) return null;
  if (case_.caseType !== 'cremation' || case_.isDeleted || isSentOrSending(case_)) return null;
  const facts = await loadFacts(organizationId, case_, mode);
  const page3 = facts.arrangementForm !== null && (facts.crematoryForm === null || facts.crematoryForm.createdAt < facts.arrangementForm.createdAt);
  const build = readinessOf(facts, false).readyToBuild && !packageIsCurrent(facts);
  const automatic = await automaticDetails(organizationId, case_, mode);
  return { page3, build, details: automatic.name !== null || automatic.date !== null };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function prepareWithLease(ctx: ActivityContext, caseId: string, mode: DataAdapterMode, options: { waitMs?: number; pollMs?: number }): Promise<AutoPrepareResult> {
  const first = await pendingWork(ctx.organizationId, caseId, mode);
  if (!first) return NOT_NEEDED;
  if (!first.page3 && !first.build && !first.details) return quietResult(ctx.organizationId, caseId, mode);

  const token = crypto.randomUUID();
  const deadline = Date.now() + (options.waitMs ?? 30_000);
  for (;;) {
    const claim = await claimPreparation(ctx.organizationId, caseId, token, mode);
    if (claim === 'claimed') break;
    if (claim === 'closed') return NOT_NEEDED;
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
      if (!work || (!work.page3 && !work.build && !work.details)) break;
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

/**
 * Claims the case's preparation lease — atomically, through the case's
 * conditional write. 'closed' once the case is sent, being sent or unclear:
 * a send and a preparation never overlap (the send likewise starts only
 * while no lease is held — see crematorySendService).
 */
async function claimPreparation(organizationId: string, caseId: string, token: string, mode: DataAdapterMode): Promise<'claimed' | 'held' | 'closed'> {
  try {
    await applyCrematoryRecord(
      organizationId,
      caseId,
      (c) => {
        if (isSentOrSending(c)) throw new CrematoryError('Sent or being sent.', 410);
        const held = c.crematory?.preparing;
        if (held && held.token !== token && Date.parse(held.until) > Date.now()) throw new CrematoryError('Being prepared by another server.', 423);
        return { preparing: { token, until: new Date(Date.now() + PREPARATION_LEASE_MS).toISOString() } };
      },
      mode,
    );
    return 'claimed';
  } catch (error) {
    if (error instanceof CrematoryError && error.status === 410) return 'closed';
    if (error instanceof CrematoryError && (error.status === 423 || error.status === 409)) return 'held';
    throw error;
  }
}

/** Whether a preparation lease is held on the case right now. */
export function preparationInProgress(case_: Case, now = Date.now()): boolean {
  const held = case_.crematory?.preparing;
  return Boolean(held && Date.parse(held.until) > now);
}

/**
 * Records the package name and expected ready date where SOLIS reliably
 * can (see automaticDetails), never over a staff confirmation, never on a
 * case sent or being sent — each recorded in the case activity. Runs only
 * inside automatic preparation, so the package is then built (or rebuilt,
 * when the Expected Pickup moved) from it — and a final review made before
 * that no longer matches.
 */
async function recordAutomaticDetails(ctx: ActivityContext, caseId: string, mode: DataAdapterMode): Promise<void> {
  const case_ = await loadCase(ctx.organizationId, caseId, mode);
  if (case_.isDeleted || isSentOrSending(case_)) return;
  const want = await automaticDetails(ctx.organizationId, case_, mode);
  if (!want.name && !want.date) return;
  const at = new Date().toISOString();
  const wrote: { name: PackageName | null; date: { date: string; previous: string | null } | null } = { name: null, date: null };
  await applyCrematoryRecord(
    ctx.organizationId,
    caseId,
    (current) => {
      wrote.name = null;
      wrote.date = null;
      if (current.isDeleted || isSentOrSending(current)) return null;
      const change: Partial<CaseCrematoryRecord> = {};
      if (want.name && !current.crematory?.packageName) {
        change.packageName = { ...want.name, confirmedBy: null, confirmedAt: at, source: 'intake_form' };
        wrote.name = want.name;
      }
      const date = current.crematory?.readyDate;
      if (want.date && (!date || date.source === 'expected_pickup')) {
        change.readyDate = { date: want.date, suggestedAtConfirmation: want.date, confirmedBy: null, confirmedAt: at, source: 'expected_pickup' };
        wrote.date = { date: want.date, previous: date?.date ?? null };
      }
      return change.packageName || change.readyDate ? change : null;
    },
    mode,
  );
  if (wrote.name) {
    await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_PACKAGE_NAME_RECORDED, {
      resourceId: null,
      description: `Name for the Crematory Package recorded from the intake form: ${wrote.name.last}, ${wrote.name.first}`,
      record: { first: wrote.name.first, last: wrote.name.last, source: 'intake_form', automatic: true },
    }, mode);
  }
  if (wrote.date) {
    const { date, previous } = wrote.date;
    await audit(ctx, caseId, ACTIVITY_EVENT_TYPES.CREMATORY_READY_DATE_RECORDED, {
      resourceId: null,
      description: `Expected cremation ready date recorded from the Expected Pickup: ${date}${previous && previous !== date ? ` (was ${previous})` : ''}`,
      record: { date, previous, source: 'expected_pickup', automatic: true },
    }, mode);
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
    await recordAutomaticDetails(ctx, caseId, mode);
  } catch (error) {
    console.error(`[crematory-auto] Case ${caseId}: the name or date could not be recorded:`, error instanceof Error ? error.message : error);
  }
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
