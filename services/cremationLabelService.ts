import crypto from 'crypto';
import type { DataAdapterMode } from '@/lib/env';
import type { ActivityContext } from './activityService';
import { recordCremationLabelPrinted } from './activityService';
import { attachDocumentActorDisplayNames, generateBillingDocument, list, readStoredCaseDocument } from './documentService';
import { loadCaseOnServer } from './serverCaseLoader';
import { DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';
import {
  cremationLabelIsDue,
  fillManorsLabel,
  manorsLabelFileBytes,
  manorsLabelValuesFor,
  manorsLabelXmlFromFile,
  readManorsLabelValues,
  type ManorsLabelResult,
  type ManorsLabelValues,
} from '@/domain/labels/manorsLabel';
import { CREMATION_LABEL_DOCUMENT_TYPE_KEY, CREMATION_LABEL_FILE_NAME, CREMATION_LABEL_MIME_TYPE } from '@/domain/labels/cremationLabel';
import type { CaseDocument } from '@/types/caseDocument';
import type { Case } from '@/types/case';

/**
 * Cremation Label (2026-10). The filled DYMO label is saved to the case as
 * an ordinary case document — same storage, same Documents tab, same
 * versioning and audit as the Envelope — so it can be printed later from
 * any computer, whether or not a printer is attached when it is saved.
 *
 * A saved label is never rewritten. Saving again after the name, tag or
 * date changed creates the next version and moves the earlier one to
 * History (generateBillingDocument's supersede rule); saving when nothing
 * changed creates nothing. Printing always uses a saved file's own bytes,
 * never a fresh fill from the case.
 */
export type SavedCremationLabel = {
  documentId: string;
  version: number | null;
  status: CaseDocument['status'];
  createdAt: string;
  actorDisplayName: string | null;
};

export type CremationLabelState = {
  /** What a label made from the case right now would say — or what is
      missing. `labelXml` lets the page preview it before it is saved. */
  current: ManorsLabelResult & { labelXml?: string };
  /** The latest saved label (the active one), if any. */
  latest: (SavedCremationLabel & { values: ManorsLabelValues | null }) | null;
  /** Whether the latest saved label is exactly what the case would produce
      now. False when there is no saved label, or the case changed. */
  latestMatchesCase: boolean;
};

export class CremationLabelError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CremationLabelError';
  }
}

const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

async function savedLabels(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode) {
  const documents = await list(organizationId, caseId, dataAdapterMode);
  return documents.filter((d) => d.origin === 'generated' && d.documentTypeKey === CREMATION_LABEL_DOCUMENT_TYPE_KEY);
}

function summarize(document: CaseDocument & { actorDisplayName: string | null }): SavedCremationLabel {
  return {
    documentId: document.id,
    version: document.version,
    status: document.status,
    createdAt: document.createdAt,
    actorDisplayName: document.actorDisplayName,
  };
}

/** Null when the case is not this organization's. */
export async function getCremationLabelState(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<CremationLabelState | null> {
  const case_ = await loadCaseOnServer(organizationId, caseId, dataAdapterMode);
  if (!case_) return null;

  const result = manorsLabelValuesFor(case_);
  const currentXml = result.ok ? fillManorsLabel(result.values) : null;
  const current = currentXml ? { ...result, labelXml: currentXml } : result;

  const active = (await savedLabels(organizationId, caseId, dataAdapterMode)).find((d) => d.status === 'active');
  if (!active) return { current, latest: null, latestMatchesCase: false };

  const [withName] = await attachDocumentActorDisplayNames([active], dataAdapterMode);
  let values: ManorsLabelValues | null = null;
  try {
    const { buffer } = await readStoredCaseDocument(organizationId, caseId, active.id, dataAdapterMode);
    values = readManorsLabelValues(manorsLabelXmlFromFile(buffer));
  } catch (error) {
    // The record is still shown; its file could not be read just now.
    console.error('Cremation label: saved file could not be read:', error instanceof Error ? error.message : error);
  }
  const latestMatchesCase = currentXml !== null && sha256(manorsLabelFileBytes(currentXml)) === active.checksumSha256;
  return { current, latest: { ...summarize(withName), values }, latestMatchesCase };
}

export type SaveCremationLabelOutcome = { outcome: 'saved' | 'unchanged'; document: CaseDocument };

/**
 * Saves the case's label as the next version. `expectedLatestDocumentId`
 * is the latest label the staff member was looking at (null for none): if
 * someone else saved one since, nothing is saved and they are told to look
 * again — so a label is never replaced by someone who never saw it.
 */
export async function saveCremationLabel(
  ctx: ActivityContext,
  caseId: string,
  expectedLatestDocumentId: string | null,
  dataAdapterMode: DataAdapterMode,
): Promise<SaveCremationLabelOutcome> {
  const case_ = await loadCaseOnServer(ctx.organizationId, caseId, dataAdapterMode);
  if (!case_) throw new CremationLabelError('Case not found.', 404);

  const result = manorsLabelValuesFor(case_);
  if (!result.ok) throw new CremationLabelError(result.message, 422);

  const active = (await savedLabels(ctx.organizationId, caseId, dataAdapterMode)).find((d) => d.status === 'active') ?? null;
  if ((active?.id ?? null) !== expectedLatestDocumentId) {
    throw new CremationLabelError('A label was saved for this case since you opened it. Close this window and open Print Label again to see the latest version.', 409);
  }

  return storeLabelVersion(ctx, caseId, result.values, active, dataAdapterMode);
}

/** Saves `values` as the next label version unless the active label already
    holds exactly these bytes. The earlier version is superseded into
    History by generateBillingDocument — kept, never rewritten. */
async function storeLabelVersion(
  ctx: ActivityContext,
  caseId: string,
  values: ManorsLabelValues,
  active: CaseDocument | null,
  dataAdapterMode: DataAdapterMode,
): Promise<SaveCremationLabelOutcome> {
  const bytes = manorsLabelFileBytes(fillManorsLabel(values));
  if (active && active.checksumSha256 === sha256(bytes)) return { outcome: 'unchanged', document: active };

  const document = await generateBillingDocument(
    {
      caseId,
      documentTypeKey: CREMATION_LABEL_DOCUMENT_TYPE_KEY,
      category: DOCUMENT_TYPES.CREMATION_FORM_CREMATION_LABEL.category,
      fileName: CREMATION_LABEL_FILE_NAME,
      existingDocumentId: active?.id,
      idFactory: () => crypto.randomUUID(),
      buildFile: async () => bytes,
      mimeType: CREMATION_LABEL_MIME_TYPE,
      fileExtension: 'dymo',
    },
    ctx,
    dataAdapterMode,
  );
  return { outcome: 'saved', document };
}

export type AutomaticCremationLabelOutcome = 'generated' | 'unchanged' | 'not_applicable' | 'failed';

/**
 * Automatic Cremation Label (2026-10). Called after a case is created or
 * saved (services/automaticCaseDocuments.ts), alongside the Envelope and
 * Certificate: once the case has the name, Tag # and Date of Cremation —
 * or when any of those three changes — the label is saved as the next
 * version, attributed to the staff member whose save caused it. Same
 * version history as a manual save. Never throws.
 */
export async function generateCremationLabelAfterCaseChange(
  before: Case | null,
  after: Case,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<AutomaticCremationLabelOutcome> {
  if (after.organizationId !== ctx.organizationId || after.isDeleted) return 'not_applicable';
  if (!getRegisteredOrganizationProfile(after.organizationId).features.dymoCaseLabel) return 'not_applicable';
  if (!cremationLabelIsDue(before, after)) return 'not_applicable';
  const result = manorsLabelValuesFor(after);
  if (!result.ok) return 'not_applicable';

  try {
    const active = (await savedLabels(ctx.organizationId, after.id, dataAdapterMode)).find((d) => d.status === 'active') ?? null;
    const { outcome } = await storeLabelVersion(ctx, after.id, result.values, active, dataAdapterMode);
    return outcome === 'saved' ? 'generated' : 'unchanged';
  } catch (error) {
    console.error(`[cremation label] Automatic label for case ${after.id} was not saved:`, error instanceof Error ? error.message : error);
    return 'failed';
  }
}

/** One saved label version, exactly as stored — what Print sends. Any
    version (latest or from History) of this case's labels. */
export async function readSavedCremationLabel(
  organizationId: string,
  caseId: string,
  documentId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ label: SavedCremationLabel; labelXml: string; values: ManorsLabelValues | null; isLatest: boolean }> {
  const labels = await savedLabels(organizationId, caseId, dataAdapterMode);
  const target = labels.find((d) => d.id === documentId);
  if (!target) throw new CremationLabelError('Saved label not found.', 404);

  const { buffer } = await readStoredCaseDocument(organizationId, caseId, documentId, dataAdapterMode).catch(() => {
    throw new CremationLabelError('The saved label could not be read from document storage. Nothing was changed. Please try again.', 503);
  });
  const labelXml = manorsLabelXmlFromFile(buffer);
  const [withName] = await attachDocumentActorDisplayNames([target], dataAdapterMode);
  return { label: summarize(withName), labelXml, values: readManorsLabelValues(labelXml), isLatest: target.status === 'active' };
}

/** Audit: a saved label version was sent to a printer. */
export async function recordSavedCremationLabelPrinted(
  ctx: ActivityContext,
  caseId: string,
  documentId: string,
  printerName: string,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  const target = (await savedLabels(ctx.organizationId, caseId, dataAdapterMode)).find((d) => d.id === documentId);
  if (!target) throw new CremationLabelError('Saved label not found.', 404);
  await recordCremationLabelPrinted(ctx, caseId, documentId, target.version, printerName.slice(0, 120), dataAdapterMode);
}
