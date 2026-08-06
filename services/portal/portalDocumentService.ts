import crypto from 'crypto';
import type { DataAdapterMode } from '../../lib/env';
import { list as listCaseDocuments, downloadFile as downloadCaseDocumentFile } from '../documentService';
import { recordPortalDocumentViewed } from '../activityService';
import { portalActivityContext } from './portalActivityContext';
import { buildPortalDocumentView, type PortalDocumentView } from '../../domain/portal/portalDocumentView';

/**
 * Phase 29 (Family Portal & External Collaboration). A thin wrapper —
 * 100% of the actual storage/checksum/versioning logic still lives in
 * `services/documentService.ts`; this file never touches
 * `lib/vercelBlob/vercelBlobStorageProvider.ts` or
 * `lib/puppeteerDocumentRenderer.ts` itself (see
 * `documentService.ts`'s own header comment on why only that file may).
 *
 * Family reads require **both** `familyVisible: true` **and**
 * `status === 'active'` — a document a staff member hasn't yet flipped
 * visible, or one still `pending`/`failed`/`archived`/`superseded`,
 * never appears here, regardless of what `hasPortalCapability` would
 * otherwise allow. A missing or non-visible document is reported
 * identically to "not found" — never distinguished, matching this
 * codebase's existence-hiding convention.
 */
export class PortalDocumentServiceError extends Error {}

function isFamilyVisibleAndActive(document: { familyVisible: boolean; status: string }): boolean {
  return document.familyVisible && document.status === 'active';
}

export async function listFamilyVisibleDocuments(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<PortalDocumentView[]> {
  const documents = await listCaseDocuments(organizationId, caseId, dataAdapterMode);
  return documents.filter(isFamilyVisibleAndActive).map(buildPortalDocumentView);
}

/** Streams the actual document bytes for a family download — reuses
    `documentService.downloadFile()` directly (re-verifying the document
    exists and is downloadable, never exposing a storage URL), attributed
    via `portalActivityContext()`. Additionally records a dedicated
    `portal.document.viewed` event carrying the real `portalUserId` —
    `documentService.downloadFile()`'s own `document.downloaded` event is
    anonymously-attributed by design (see `portalActivityContext.ts`), so
    this is the one place real, queryable "which family member viewed
    this" attribution is captured. */
export async function downloadFamilyDocument(
  organizationId: string,
  caseId: string,
  documentId: string,
  portalUserId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  const documents = await listCaseDocuments(organizationId, caseId, dataAdapterMode);
  const target = documents.find((d) => d.id === documentId);
  if (!target || !isFamilyVisibleAndActive(target)) {
    throw new PortalDocumentServiceError('Document not found.');
  }

  const correlationId = crypto.randomUUID();
  const ctx = portalActivityContext(organizationId, correlationId);
  const result = await downloadCaseDocumentFile(organizationId, caseId, documentId, ctx, dataAdapterMode);

  try {
    await recordPortalDocumentViewed(ctx, caseId, documentId, portalUserId, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record portal.document.viewed activity event:', error instanceof Error ? error.message : error);
  }

  return result;
}
