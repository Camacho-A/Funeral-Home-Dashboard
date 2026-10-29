import crypto from 'crypto';
import fs from 'fs/promises';
import type { DataAdapterMode } from '../lib/env';
import type { Case } from '../types/case';
import type { ActivityContext } from './activityService';
import { DOCUMENT_TYPES } from '../domain/documents/documentTypeRegistry';
import {
  envelopeTrigger,
  hasValidTagNumber,
  missingOfficialDocumentFields,
  officialDocumentsFor,
  officialDocumentsToRegenerate,
  type OfficialDocumentKind,
} from '../domain/documents/officialDocumentTriggers';
import { DocumentNotFoundError } from '../lib/documentStorageProvider';
import { composeDecedentName } from '../domain/cases/decedentName';
import { formatReceiptDate } from '../domain/billing/receiptOfPayment';
import { toDisplayName } from '../utils/displayName';
import { generateBillingDocument, downloadOrgDocumentBytes, list as listCaseDocuments } from './documentService';
import { loadCaseOnServer } from './serverCaseLoader';
import { buildCertificateOfCremationPdf, buildEnvelopePdf } from './officialDocumentTemplates';
import { generateCremationLabelAfterCaseChange, type AutomaticCremationLabelOutcome } from './cremationLabelService';
import { extractCrematoryFormAfterCaseChange, type AutomaticCrematoryFormOutcome } from './arrangementPageExtractService';
import { sendToCrematoryConfig } from '../domain/crematory/crematorySettings';
import { workflowStageComplete } from '../domain/documents/arrangementPageExtracts';

/**
 * Automatic Envelope and Certificate of Cremation (2026-10). See
 * domain/documents/officialDocumentTriggers.ts for when, and
 * services/officialDocumentTemplates.ts for how each is filled from the
 * organization's official file. Both are stored through the same
 * generated-document path as every other system document: versioned, the
 * previous version superseded into History, audited, and announced.
 */
/**
 *   not_applicable        this organization does not have the document
 *   missing_information   the case lacks something the document prints
 *                         (see missingOfficialDocumentFields)
 *   template_unavailable  the signed certificate is not configured, or is
 *                         not stored at the configured key
 *   failed                anything else (rendering, storage, records)
 */
export type OfficialDocumentOutcome = 'generated' | 'not_applicable' | 'missing_information' | 'template_unavailable' | 'failed';

/**
 * The signed certificate is NOT in the repository (it carries a real
 * signature and seal, and the repository is public). It is read from the
 * organization's private document storage, at the key in
 * CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY. For local development a
 * file path may be given instead (CERTIFICATE_OF_CREMATION_TEMPLATE_PATH).
 * With neither, or when nothing is stored at the configured key, the
 * certificate is reported as unavailable — never approximated. Any other
 * storage error (credentials, network) is thrown and reported as a failure.
 */
export type CertificateTemplate =
  | { status: 'loaded'; bytes: Uint8Array }
  | { status: 'not_configured' }
  | { status: 'not_found'; storageKey: string };

export async function loadCertificateTemplate(): Promise<CertificateTemplate> {
  const storageKey = process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY?.trim();
  if (storageKey) {
    try {
      return { status: 'loaded', bytes: new Uint8Array((await downloadOrgDocumentBytes(storageKey)).buffer) };
    } catch (error) {
      if (error instanceof DocumentNotFoundError) return { status: 'not_found', storageKey };
      throw error;
    }
  }
  const localPath = process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_PATH?.trim();
  if (localPath) return { status: 'loaded', bytes: new Uint8Array(await fs.readFile(localPath)) };
  return { status: 'not_configured' };
}

const displayName = (c: Case) => toDisplayName(composeDecedentName(c.decedentName, c.decedentMiddleName));

export async function generateOfficialDocument(
  kind: OfficialDocumentKind,
  case_: Case,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<OfficialDocumentOutcome> {
  if (case_.organizationId !== ctx.organizationId || !officialDocumentsFor(case_.organizationId).includes(kind)) return 'not_applicable';

  // Checked before anything is loaded or written, so a case missing
  // information never touches storage or the document records.
  if (missingOfficialDocumentFields(kind, case_).length > 0) return 'missing_information';

  try {
    if (kind === 'envelope') {
      await generateBillingDocument(
        {
          caseId: case_.id,
          documentTypeKey: DOCUMENT_TYPES.LETTER_ENVELOPE.key,
          category: 'letter',
          fileName: 'Envelope.pdf',
          buildPdf: () => buildEnvelopePdf({ decedentDisplayName: displayName(case_) }),
          idFactory: () => crypto.randomUUID(),
        },
        ctx,
        dataAdapterMode,
      );
      return 'generated';
    }

    const template = await loadCertificateTemplate();
    if (template.status === 'not_configured') {
      console.error(`[official documents] Certificate of Cremation for case ${case_.id} not generated: the signed template is not configured.`);
      return 'template_unavailable';
    }
    if (template.status === 'not_found') {
      console.error(
        `[official documents] Certificate of Cremation for case ${case_.id} not generated: no file is stored at ` +
          `CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY ("${template.storageKey}"). The key must match the template's exact path in document storage.`,
      );
      return 'template_unavailable';
    }
    await generateBillingDocument(
      {
        caseId: case_.id,
        documentTypeKey: DOCUMENT_TYPES.CREMATION_FORM_CERTIFICATE_OF_CREMATION.key,
        category: 'cremation_form',
        fileName: 'Certificate of Cremation.pdf',
        buildPdf: () =>
          buildCertificateOfCremationPdf(template.bytes, {
            tagNumber: case_.tagNumber,
            decedentDisplayName: displayName(case_),
            dateOfDeath: formatReceiptDate(case_.dateOfDeath),
            dateOfCremation: formatReceiptDate(case_.dateOfCremation)!,
          }),
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
    return 'generated';
  } catch (error) {
    console.error(
      `[official documents] ${kind} for case ${case_.id} was not generated:`,
      error instanceof Error ? error.message : error,
    );
    return 'failed';
  }
}

/**
 * Envelope duplicate guard (2026-10). The Envelope carries only the name:
 *   - a saved or corrected Tag Number creates one only if the case has none
 *     (correcting a Tag Number never produces an identical second copy);
 *   - a name change regenerates an existing Envelope, or creates the first
 *     one on a case that already has a Tag Number (the previous behaviour).
 * Fails safe: if the documents cannot be read, nothing is generated.
 */
async function envelopeIsDue(before: Case | null, after: Case, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  const trigger = envelopeTrigger(before, after);
  if (trigger === null) return false;
  let hasEnvelope: boolean;
  try {
    const documents = await listCaseDocuments(after.organizationId, after.id, dataAdapterMode);
    hasEnvelope = documents.some((d) => d.documentTypeKey === DOCUMENT_TYPES.LETTER_ENVELOPE.key && d.status === 'active');
  } catch (error) {
    console.error(`[official documents] Could not check case ${after.id} for an existing Envelope; skipping automatic generation:`, error instanceof Error ? error.message : error);
    return false;
  }
  return trigger === 'tag_saved' ? !hasEnvelope : hasEnvelope || hasValidTagNumber(after);
}

/** After a case is created or saved: regenerates whatever the change
    affects — the Envelope, the Certificate of Cremation and (2026-10) the
    Cremation Label and the Crematory Form. `before` is null for a new
    case. Never throws. */
export async function regenerateOfficialDocumentsAfterCaseChange(
  before: Case | null,
  after: Case,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<AutomaticDocumentResults> {
  const results: AutomaticDocumentResults = {};
  for (const kind of officialDocumentsToRegenerate(before, after)) {
    if (kind === 'envelope' && !(await envelopeIsDue(before, after, dataAdapterMode))) continue;
    results[kind] = await generateOfficialDocument(kind, after, ctx, dataAdapterMode);
  }
  const label = await generateCremationLabelAfterCaseChange(before, after, ctx, dataAdapterMode);
  if (label !== 'not_applicable') results.cremation_label = label;
  const crematoryForm = await extractCrematoryFormAfterCaseChange(before, after, ctx, dataAdapterMode);
  if (crematoryForm !== 'not_applicable') results.crematory_form = crematoryForm;
  // Send to Crematory (2026-10): workflow 2 just completed (or page 3 was
  // just saved) — the Crematory Package may now be ready to prepare.
  const config = sendToCrematoryConfig(after.organizationId);
  if (
    config &&
    after.organizationId === ctx.organizationId &&
    (crematoryForm === 'generated' ||
      (workflowStageComplete(after, config.authorizationWorkflowStage) && !(before && workflowStageComplete(before, config.authorizationWorkflowStage))))
  ) {
    const { prepareCrematoryDocuments } = await import('./crematory/crematoryPackageService');
    await prepareCrematoryDocuments(ctx, after.id, dataAdapterMode);
  }
  return results;
}

export type AutomaticDocumentResults = Partial<Record<OfficialDocumentKind, OfficialDocumentOutcome>> & {
  cremation_label?: AutomaticCremationLabelOutcome;
  crematory_form?: AutomaticCrematoryFormOutcome;
};

/** Staff-requested regeneration (e.g. after a failure): loads the case
    scoped to the caller's organization first. `missing` names what the
    case still needs when the outcome is "missing_information". */
export async function generateOfficialDocumentForCase(
  kind: OfficialDocumentKind,
  caseId: string,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<{ outcome: OfficialDocumentOutcome | 'case_not_found'; missing: string[] }> {
  const case_ = await loadCaseOnServer(ctx.organizationId, caseId, dataAdapterMode);
  if (!case_) return { outcome: 'case_not_found', missing: [] };
  const outcome = await generateOfficialDocument(kind, case_, ctx, dataAdapterMode);
  return { outcome, missing: outcome === 'missing_information' ? missingOfficialDocumentFields(kind, case_) : [] };
}
