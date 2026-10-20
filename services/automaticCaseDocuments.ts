import crypto from 'crypto';
import fs from 'fs/promises';
import type { DataAdapterMode } from '../lib/env';
import type { Case } from '../types/case';
import type { ActivityContext } from './activityService';
import { DOCUMENT_TYPES } from '../domain/documents/documentTypeRegistry';
import { officialDocumentsFor, officialDocumentsToRegenerate, type OfficialDocumentKind } from '../domain/documents/officialDocumentTriggers';
import { composeDecedentName } from '../domain/cases/decedentName';
import { formatReceiptDate } from '../domain/billing/receiptOfPayment';
import { toDisplayName } from '../utils/displayName';
import { generateBillingDocument, downloadOrgDocumentBytes } from './documentService';
import { loadCaseOnServer } from './serverCaseLoader';
import { buildCertificateOfCremationPdf, buildEnvelopePdf } from './officialDocumentTemplates';

/**
 * Automatic Envelope and Certificate of Cremation (2026-10). See
 * domain/documents/officialDocumentTriggers.ts for when, and
 * services/officialDocumentTemplates.ts for how each is filled from the
 * organization's official file. Both are stored through the same
 * generated-document path as every other system document: versioned, the
 * previous version superseded into History, audited, and announced.
 */
export type OfficialDocumentOutcome = 'generated' | 'not_applicable' | 'template_unavailable' | 'failed';

/**
 * The signed certificate is NOT in the repository (it carries a real
 * signature and seal, and the repository is public). It is read from the
 * organization's private document storage, at the key in
 * CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY. For local development a
 * file path may be given instead (CERTIFICATE_OF_CREMATION_TEMPLATE_PATH).
 * With neither, the certificate is reported as unavailable — never
 * approximated.
 */
export async function loadCertificateTemplate(): Promise<Uint8Array | null> {
  const storageKey = process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY?.trim();
  if (storageKey) return new Uint8Array((await downloadOrgDocumentBytes(storageKey)).buffer);
  const localPath = process.env.CERTIFICATE_OF_CREMATION_TEMPLATE_PATH?.trim();
  if (localPath) return new Uint8Array(await fs.readFile(localPath));
  return null;
}

const displayName = (c: Case) => toDisplayName(composeDecedentName(c.decedentName, c.decedentMiddleName));

export async function generateOfficialDocument(
  kind: OfficialDocumentKind,
  case_: Case,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<OfficialDocumentOutcome> {
  if (case_.organizationId !== ctx.organizationId || !officialDocumentsFor(case_.organizationId).includes(kind)) return 'not_applicable';

  try {
    if (kind === 'envelope') {
      if (!case_.decedentName?.trim()) return 'not_applicable';
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

    const dateOfCremation = formatReceiptDate(case_.dateOfCremation);
    if (!case_.decedentName?.trim() || !dateOfCremation) return 'not_applicable';
    const template = await loadCertificateTemplate();
    if (!template) {
      console.error(`[official documents] Certificate of Cremation for case ${case_.id} not generated: the signed template is not configured.`);
      return 'template_unavailable';
    }
    await generateBillingDocument(
      {
        caseId: case_.id,
        documentTypeKey: DOCUMENT_TYPES.CREMATION_FORM_CERTIFICATE_OF_CREMATION.key,
        category: 'cremation_form',
        fileName: 'Certificate of Cremation.pdf',
        buildPdf: () =>
          buildCertificateOfCremationPdf(template, {
            tagNumber: case_.tagNumber,
            decedentDisplayName: displayName(case_),
            dateOfDeath: formatReceiptDate(case_.dateOfDeath),
            dateOfCremation,
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

/** After a case is created or saved: regenerates whatever the change
    affects. `before` is null for a new case. Never throws. */
export async function regenerateOfficialDocumentsAfterCaseChange(
  before: Case | null,
  after: Case,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<Partial<Record<OfficialDocumentKind, OfficialDocumentOutcome>>> {
  const results: Partial<Record<OfficialDocumentKind, OfficialDocumentOutcome>> = {};
  for (const kind of officialDocumentsToRegenerate(before, after)) {
    results[kind] = await generateOfficialDocument(kind, after, ctx, dataAdapterMode);
  }
  return results;
}

/** Staff-requested regeneration (e.g. after a failure): loads the case
    scoped to the caller's organization first. */
export async function generateOfficialDocumentForCase(
  kind: OfficialDocumentKind,
  caseId: string,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<OfficialDocumentOutcome | 'case_not_found'> {
  const case_ = await loadCaseOnServer(ctx.organizationId, caseId, dataAdapterMode);
  if (!case_) return 'case_not_found';
  return generateOfficialDocument(kind, case_, ctx, dataAdapterMode);
}
