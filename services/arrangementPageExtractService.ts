import crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import type { DataAdapterMode } from '@/lib/env';
import type { ActivityContext } from './activityService';
import { recordArrangementPageExtracted } from './activityService';
import { generateBillingDocument, list as listCaseDocuments, readStoredCaseDocument } from './documentService';
import { loadCaseOnServer } from './serverCaseLoader';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import {
  ARRANGEMENT_EXTRACTS,
  ARRANGEMENT_FORMS_DOCUMENT_TYPE_KEY,
  crematoryFormIsDue,
  crematoryPermitStatus,
  type ArrangementExtractKind,
  type CrematoryPermitStatus,
} from '@/domain/documents/arrangementPageExtracts';
import { DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';
import type { CaseDocument } from '@/types/caseDocument';
import type { Case } from '@/types/case';

/**
 * ME Form / Crematory Form (2026-10). Copies one page, unchanged, out of the
 * case's completed Arrangement Forms PDF into its own single-page PDF and
 * saves it as a case document through the existing pipeline (versioned,
 * superseded into History, audited). The page is copied with its own
 * content and images exactly as they are — never redrawn or re-created —
 * and the Arrangement Forms document itself is only ever read.
 *
 * The copy is byte-for-byte repeatable, so extracting again from the same
 * source produces nothing new; a changed source produces the next version.
 * Nothing is ever sent anywhere.
 */
export class ArrangementExtractError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ArrangementExtractError';
  }
}

type Extracted = CaseDocument;

export type ArrangementExtractsState = {
  /** The Arrangement Forms PDF pages would be taken from (latest active). */
  source: { documentId: string; fileName: string; createdAt: string } | null;
  isMedicalExaminerCase: boolean;
  permit: CrematoryPermitStatus;
  latest: Record<ArrangementExtractKind, { documentId: string; version: number | null; createdAt: string } | null>;
};

const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');

function latestActive(documents: CaseDocument[], documentTypeKey: string, origin?: CaseDocument['origin']): CaseDocument | null {
  return (
    documents
      .filter((d) => d.documentTypeKey === documentTypeKey && d.status === 'active' && (origin === undefined || d.origin === origin))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null
  );
}

function sourceOf(documents: CaseDocument[]): CaseDocument | null {
  return (
    documents
      .filter((d) => d.documentTypeKey === ARRANGEMENT_FORMS_DOCUMENT_TYPE_KEY && d.status === 'active' && d.mimeType === 'application/pdf')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null
  );
}

function assertEnabled(organizationId: string) {
  if (!getRegisteredOrganizationProfile(organizationId).features.arrangementPageExtracts) {
    throw new ArrangementExtractError('The Release Form and Crematory Form are not set up for this organization.', 404);
  }
}

/** One page of `source`, as its own PDF. Repeatable byte for byte: no
    metadata (dates, producer) is added that would differ between runs. */
export async function extractPdfPage(source: Uint8Array, page: number): Promise<{ bytes: Uint8Array; sourcePageCount: number }> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(source, { updateMetadata: false });
  } catch {
    throw new ArrangementExtractError('The Arrangement Form PDF on this case could not be read, so nothing was extracted.', 422);
  }
  const sourcePageCount = document.getPageCount();
  if (sourcePageCount < page) {
    throw new ArrangementExtractError(
      `The Arrangement Form on this case has ${sourcePageCount} page${sourcePageCount === 1 ? '' : 's'}, so page ${page} cannot be extracted. Nothing was created.`,
      422,
    );
  }
  const output = await PDFDocument.create({ updateMetadata: false });
  const [copied] = await output.copyPages(document, [page - 1]);
  output.addPage(copied);
  return { bytes: await output.save(), sourcePageCount };
}

export async function getArrangementExtractsState(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<ArrangementExtractsState | null> {
  assertEnabled(organizationId);
  const case_ = await loadCaseOnServer(organizationId, caseId, dataAdapterMode);
  if (!case_) return null;
  const documents = await listCaseDocuments(organizationId, caseId, dataAdapterMode);
  const source = sourceOf(documents);
  const summary = (kind: ArrangementExtractKind) => {
    const doc = latestActive(documents, ARRANGEMENT_EXTRACTS[kind].documentTypeKey, 'generated');
    return doc ? { documentId: doc.id, version: doc.version, createdAt: doc.createdAt } : null;
  };
  return {
    source: source ? { documentId: source.id, fileName: source.fileName, createdAt: source.createdAt } : null,
    isMedicalExaminerCase: case_.isMedicalExaminerCase === true,
    permit: crematoryPermitStatus(case_),
    latest: { me_form: summary('me_form'), crematory_form: summary('crematory_form') },
  };
}

export type ExtractOutcome = { outcome: 'saved' | 'unchanged'; document: Extracted };

/**
 * Extracts `kind`'s page from the case's latest Arrangement Forms PDF and
 * saves it as the next version — or reports `unchanged` when the latest
 * saved copy is already exactly this page. Refuses, creating nothing:
 *   - the ME Form on a case not marked as a Medical Examiner case;
 *   - the Crematory Form when the permit is not confirmed by the case's own
 *     data and the staff member has not confirmed verifying it;
 *   - a case with no Arrangement Forms PDF, or one too short.
 */
export async function extractArrangementPage(
  kind: ArrangementExtractKind,
  caseId: string,
  options: { permitVerifiedByStaff?: boolean },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<ExtractOutcome> {
  assertEnabled(ctx.organizationId);
  const spec = ARRANGEMENT_EXTRACTS[kind];
  const case_ = await loadCaseOnServer(ctx.organizationId, caseId, dataAdapterMode);
  if (!case_) throw new ArrangementExtractError('Case not found.', 404);
  if (case_.isDeleted) throw new ArrangementExtractError('This case is archived. Restore it before adding documents.', 409);

  if (kind === 'me_form' && case_.isMedicalExaminerCase !== true) {
    throw new ArrangementExtractError('The Release Form is for Medical Examiner cases. Mark this case as a Medical Examiner case first.', 422);
  }
  let permitBasis: string | null = null;
  if (kind === 'crematory_form') {
    const permit = crematoryPermitStatus(case_);
    if (permit.confirmed) permitBasis = permit.basis;
    else if (options.permitVerifiedByStaff === true) permitBasis = 'verified by staff';
    else {
      throw new ArrangementExtractError(
        "The permit isn't confirmed in this case's information yet. Confirm you have verified the permit is available, or record it on the case first.",
        428,
      );
    }
  }

  const documents = await listCaseDocuments(ctx.organizationId, caseId, dataAdapterMode);
  const source = sourceOf(documents);
  if (!source) throw new ArrangementExtractError('This case has no Arrangement Form PDF yet, so nothing was extracted.', 422);

  let sourceBytes: Buffer;
  try {
    sourceBytes = (await readStoredCaseDocument(ctx.organizationId, caseId, source.id, dataAdapterMode)).buffer;
  } catch {
    throw new ArrangementExtractError('The Arrangement Form PDF could not be read from document storage. Nothing was created. Please try again.', 503);
  }
  const { bytes } = await extractPdfPage(new Uint8Array(sourceBytes), spec.page);

  const active = latestActive(documents, spec.documentTypeKey, 'generated');
  if (active && active.checksumSha256 === sha256(bytes)) return { outcome: 'unchanged', document: active };

  const document = await generateBillingDocument(
    {
      caseId,
      documentTypeKey: spec.documentTypeKey,
      category: kind === 'me_form' ? DOCUMENT_TYPES.EXTERNAL_FORM_ME_FORM.category : DOCUMENT_TYPES.EXTERNAL_FORM_CREMATORY_FORM.category,
      fileName: spec.fileName,
      existingDocumentId: active?.id,
      idFactory: () => crypto.randomUUID(),
      buildPdf: async () => bytes,
    },
    ctx,
    dataAdapterMode,
  );
  try {
    await recordArrangementPageExtracted(
      ctx,
      caseId,
      document.id,
      { displayName: spec.displayName, version: document.version, page: spec.page, sourceDocumentId: source.id, permitBasis },
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to record document.page_extracted activity event:', error instanceof Error ? error.message : error);
  }
  return { outcome: 'saved', document };
}

export type AutomaticCrematoryFormOutcome = 'generated' | 'unchanged' | 'not_applicable' | 'missing_source' | 'failed';

/**
 * Automatic Crematory Form (2026-10). Called after a case is created or
 * saved (services/automaticCaseDocuments.ts): when the save checks the last
 * step of workflow 2 while "Permit sent to crematory" (the first step of
 * workflow 3) is still pending, page 3 of the Arrangement Forms is saved as
 * the Crematory Form, attributed to the staff member whose save caused it.
 * Same extraction, versioning and audit as the button; nothing is sent.
 * Never throws: a case with no Arrangement Form yet is reported, not failed,
 * and the button stays available.
 */
export async function extractCrematoryFormAfterCaseChange(
  before: Case | null,
  after: Case,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<AutomaticCrematoryFormOutcome> {
  if (after.organizationId !== ctx.organizationId) return 'not_applicable';
  if (!getRegisteredOrganizationProfile(after.organizationId).features.arrangementPageExtracts) return 'not_applicable';
  if (!crematoryFormIsDue(before, after)) return 'not_applicable';
  try {
    const { outcome } = await extractArrangementPage('crematory_form', after.id, {}, ctx, dataAdapterMode);
    return outcome === 'saved' ? 'generated' : 'unchanged';
  } catch (error) {
    if (error instanceof ArrangementExtractError && error.status === 422) {
      console.warn(`[crematory form] Case ${after.id} reached the permit step but its Crematory Form was not extracted: ${error.message}`);
      return 'missing_source';
    }
    console.error(`[crematory form] Automatic Crematory Form for case ${after.id} failed:`, error instanceof Error ? error.message : error);
    return 'failed';
  }
}
