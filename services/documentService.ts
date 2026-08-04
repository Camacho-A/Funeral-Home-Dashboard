import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem } from '../lib/wixDataApi';
import {
  mapWixCaseDocumentItem,
  buildWixCaseDocumentData,
  applyCaseDocumentGenerationResultToWixData,
  applyCaseDocumentStatusToWixData,
  applyCaseDocumentSignatureStatusToWixData,
  type WixCaseDocumentItem,
} from '../lib/wixCaseDocumentMapper';
import { mapWixCaseItem, type WixCaseItem } from '../lib/wixCaseMapper';
import { mapWixOrganizationItem, type WixOrganizationItem } from '../lib/wixOrganizationMapper';
import { mapWixOrganizationBrandingItem, type WixOrganizationBrandingItem } from '../lib/wixOrganizationBrandingMapper';
import { mapWixOrganizationLocationItem, type WixOrganizationLocationItem } from '../lib/wixOrganizationLocationMapper';
import type { CaseDocument, CaseDocumentStatus, NewGeneratedDocumentInput, NewUploadedDocumentInput } from '../types/caseDocument';
import type { Case } from '../types/case';
import type { Organization } from '../types/organization';
import { caseFixtures } from './__mocks__/fixtures';
import { mockOrganizationFixtures } from './__mocks__/authFixtures';
import { organizationBrandingFixtures, organizationLocationFixtures } from './__mocks__/onboardingFixtures';
import { caseDocumentFixtures } from './__mocks__/documentFixtures';
import { get as getTemplate, getActiveVersion } from './documentTemplatesService';
import { getActiveCaseOrder } from './pricingService';
import { listAppointmentsForCase } from './scheduling/appointmentReads';
import { resolveMergeContext, mergeTemplate, type MergeSourceData } from '../domain/documents/mergeEngine';
import { puppeteerDocumentRenderer } from '../lib/puppeteerDocumentRenderer';
import { vercelBlobStorageProvider } from '../lib/vercelBlob/vercelBlobStorageProvider';
import type { DocumentRenderer } from '../lib/documentRenderer';
import type { DocumentStorageProvider } from '../lib/documentStorageProvider';
import {
  recordDocumentGenerated,
  recordDocumentRegenerated,
  recordDocumentUploaded,
  recordDocumentDownloaded,
  recordDocumentArchived,
  type ActivityContext,
} from './activityService';

/**
 * Phase 25 (Document Generation & Template Management). **`DocumentService`**
 * — the single orchestration layer for everything that touches a
 * `CaseDocument`'s lifecycle (list/generate/regenerate/upload/archive/
 * download): resolving merge data, invoking the renderer, invoking
 * storage, computing the checksum, persisting the row, and emitting the
 * `ActivityEvent`, all in one place. No Route Handler and no UI component
 * ever calls `puppeteerDocumentRenderer`/`vercelBlobStorageProvider`/
 * `activityService.record()` directly for a document action — only this
 * file does. `services/documentService.test.ts`'s own structural test
 * asserts this file is the only one importing
 * `lib/puppeteerDocumentRenderer.ts`/`lib/vercelBlob/vercelBlobStorageProvider.ts`.
 *
 * The concrete renderer/storage provider are imported directly (matching
 * `lib/clover/cloverProvider.ts`'s own precedent — Beacon has no central
 * "getPaymentProvider()" indirection today, just a direct import of the
 * one real implementation), but every function below is typed against
 * the neutral `DocumentRenderer`/`DocumentStorageProvider` interfaces —
 * swapping either later is a new file + these two import lines, no
 * change to the logic below.
 *
 * **Invariant**: a `pending` row (inserted the instant generation starts,
 * so a mid-request crash during a slow render leaves a diagnosable row
 * rather than silently losing the attempt) has its content fields filled
 * in exactly once when the render-and-store work completes or fails —
 * mirrors `PaymentRecord`'s own `pending -> succeeded/failed` update.
 * Once a row reaches `active`/`failed`, it is immutable except for a
 * later `status` flip (superseded via regeneration, archived, restored).
 */

const documentRenderer: DocumentRenderer = puppeteerDocumentRenderer;
const documentStorageProvider: DocumentStorageProvider = vercelBlobStorageProvider;

export class DocumentServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Merge source data resolution — reads Case/CaseOrder/Organization/
// Branding/primary Location server-side. None of these collections has a
// shared server-side read function elsewhere in this codebase (cases/
// organizations are read via client-fetch services); these small
// mock/wix-branching readers exist here because DocumentService, unlike
// every Route Handler, must run this resolution server-side as one step
// of a larger orchestration, not as its own request/response.
// ---------------------------------------------------------------------------

async function getCaseForMerge(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<Case | null> {
  if (dataAdapterMode === 'mock') {
    return caseFixtures.find((c) => c.id === caseId && c.organizationId === organizationId && !c.isDeleted) ?? null;
  }
  const response = await queryWixDataItems<WixCaseItem>('cases', {
    filter: { beaconCaseId: caseId, organizationId, isArchived: false },
    paging: { limit: 1 },
  });
  return mapWixCaseItem(response.dataItems[0]?.data);
}

async function getOrganizationForMerge(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<Organization | null> {
  if (dataAdapterMode === 'mock') {
    return mockOrganizationFixtures.find((org) => org.id === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationItem>('organizations', {
    filter: { beaconOrganizationId: organizationId },
    paging: { limit: 1 },
  });
  return mapWixOrganizationItem(response.dataItems[0]?.data);
}

async function getBrandingForMerge(organizationId: string, dataAdapterMode: DataAdapterMode) {
  if (dataAdapterMode === 'mock') {
    return organizationBrandingFixtures.find((b) => b.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationBrandingItem>('organizationBranding', {
    filter: { organizationId },
    paging: { limit: 1 },
  });
  return mapWixOrganizationBrandingItem(response.dataItems[0]?.data);
}

async function getPrimaryLocationForMerge(organizationId: string, dataAdapterMode: DataAdapterMode) {
  if (dataAdapterMode === 'mock') {
    return organizationLocationFixtures.find((loc) => loc.organizationId === organizationId && loc.isPrimary) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationLocationItem>('organizationLocations', {
    filter: { organizationId, isPrimary: true },
    paging: { limit: 1 },
  });
  return mapWixOrganizationLocationItem(response.dataItems[0]?.data);
}

/** Phase 27 (Scheduling & Resource Management). Looks up a *specific*
    `OrganizationLocation` by id — distinct from `getPrimaryLocationForMerge`
    above, which only ever resolves the organization's primary address.
    Used to resolve `MergeSourceData.serviceAppointmentLocation` from a
    scheduled service appointment's `locationId`, which may or may not be
    the organization's primary location. */
async function getLocationByIdForMerge(organizationId: string, locationId: string, dataAdapterMode: DataAdapterMode) {
  if (dataAdapterMode === 'mock') {
    return organizationLocationFixtures.find((loc) => loc.organizationId === organizationId && loc.id === locationId) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationLocationItem>('organizationLocations', {
    filter: { organizationId, beaconLocationId: locationId },
    paging: { limit: 1 },
  });
  return mapWixOrganizationLocationItem(response.dataItems[0]?.data);
}

/** Phase 27 (Scheduling & Resource Management). Resolves the case's nearest
    non-cancelled funeral/graveside service appointment via the canonical
    `SchedulingService` appointment model (`services/scheduling/appointmentReads.ts`)
    — never a document-specific scheduling lookup, per the Phase 27 plan's
    refinement requiring `case.service.date`/`case.service.location` to be
    resolved from the real scheduling data. Null when no such appointment
    exists yet. */
async function getServiceAppointmentForMerge(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode) {
  const appointments = await listAppointmentsForCase(organizationId, caseId, dataAdapterMode);
  const candidates = appointments.filter(
    (a) => a.status !== 'cancelled' && (a.appointmentType === 'funeral.service' || a.appointmentType === 'graveside.service'),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, current) => (current.startAt < earliest.startAt ? current : earliest));
}

/** Exported for `POST /api/document-templates/[templateId]/preview`,
    which needs the exact same real-case merge resolution `generate()`
    uses — no separate implementation. */
export async function resolveMergeSourceData(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<MergeSourceData> {
  const [caseRecord, caseOrder, organization, branding, location, serviceAppointment] = await Promise.all([
    getCaseForMerge(organizationId, caseId, dataAdapterMode),
    getActiveCaseOrder(organizationId, caseId, dataAdapterMode),
    getOrganizationForMerge(organizationId, dataAdapterMode),
    getBrandingForMerge(organizationId, dataAdapterMode),
    getPrimaryLocationForMerge(organizationId, dataAdapterMode),
    getServiceAppointmentForMerge(organizationId, caseId, dataAdapterMode),
  ]);
  if (!caseRecord) throw new DocumentServiceError('Case not found.');
  if (!organization) throw new DocumentServiceError('Organization not found.');
  const serviceAppointmentLocation = serviceAppointment?.locationId
    ? await getLocationByIdForMerge(organizationId, serviceAppointment.locationId, dataAdapterMode)
    : null;
  return { case: caseRecord, caseOrder, organization, branding, location, serviceAppointment, serviceAppointmentLocation };
}

function wrapMergedHtmlDocument(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>
    @page { margin: 0.75in; }
    body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; color: #1a1a1a; }
  </style></head><body>${bodyHtml}</body></html>`;
}

// ---------------------------------------------------------------------------
// Persistence — mirrors services/pricingService.ts's persist*/status-flip
// shape exactly.
// ---------------------------------------------------------------------------

async function persistPendingDocument(document: CaseDocument, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    caseDocumentFixtures.push(document);
    return;
  }
  await insertWixDataItem<WixCaseDocumentItem>('caseDocuments', buildWixCaseDocumentData(document), document.id);
}

async function completeDocumentGeneration(
  organizationId: string,
  documentId: string,
  result: { status: CaseDocumentStatus; storageKey: string; checksumSha256: string; fileSizeBytes: number },
  dataAdapterMode: DataAdapterMode,
): Promise<CaseDocument> {
  if (dataAdapterMode === 'mock') {
    const index = caseDocumentFixtures.findIndex((d) => d.id === documentId && d.organizationId === organizationId);
    if (index === -1) throw new DocumentServiceError('Document not found during generation completion.');
    caseDocumentFixtures[index] = { ...caseDocumentFixtures[index], ...result };
    return caseDocumentFixtures[index];
  }
  const response = await queryWixDataItems<WixCaseDocumentItem>('caseDocuments', {
    filter: { organizationId, beaconCaseDocumentId: documentId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new DocumentServiceError('Document not found during generation completion.');
  const merged = applyCaseDocumentGenerationResultToWixData(existingItem.data, result);
  const updated = await updateWixDataItem<WixCaseDocumentItem>('caseDocuments', existingItem.id, merged);
  const mapped = mapWixCaseDocumentItem(updated.data);
  if (!mapped) throw new DocumentServiceError('Failed to update document after generation.');
  return mapped;
}

async function updateDocumentStatus(organizationId: string, documentId: string, status: CaseDocumentStatus, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = caseDocumentFixtures.findIndex((d) => d.id === documentId && d.organizationId === organizationId);
    if (index !== -1) caseDocumentFixtures[index] = { ...caseDocumentFixtures[index], status };
    return;
  }
  const response = await queryWixDataItems<WixCaseDocumentItem>('caseDocuments', {
    filter: { organizationId, beaconCaseDocumentId: documentId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;
  const merged = applyCaseDocumentStatusToWixData(existingItem.data, status);
  await updateWixDataItem('caseDocuments', existingItem.id, merged);
}

/** Phase 26 (Electronic Signatures & Authorization Workflows). The only
    function anywhere that ever writes `CaseDocument.signatureStatus:
    'signed'` — called exclusively from `services/signatureService.ts`'s
    `completeSignatureRequest`, once a signature is actually complete.
    Touches the orthogonal `signatureStatus` field instead of `status` (a
    document can be `active`/`archived` independently of whether it's
    been signed). Unlike `updateDocumentStatus`'s lenient no-op-if-missing
    behavior (that function is called in secondary/best-effort contexts
    elsewhere), this throws in both modes on a missing document — a
    signature has just been completed and the caller must know for
    certain whether the document lock actually took effect. */
export async function markDocumentSigned(organizationId: string, caseId: string, documentId: string, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = caseDocumentFixtures.findIndex((d) => d.id === documentId && d.organizationId === organizationId && d.caseId === caseId);
    if (index === -1) throw new DocumentServiceError('Document not found while marking it signed.');
    caseDocumentFixtures[index] = { ...caseDocumentFixtures[index], signatureStatus: 'signed' };
    return;
  }
  const response = await queryWixDataItems<WixCaseDocumentItem>('caseDocuments', {
    filter: { organizationId, caseId, beaconCaseDocumentId: documentId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) throw new DocumentServiceError('Document not found while marking it signed.');
  const merged = applyCaseDocumentSignatureStatusToWixData(existingItem.data, 'signed');
  await updateWixDataItem('caseDocuments', existingItem.id, merged);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function list(organizationId: string, caseId: string, dataAdapterMode: DataAdapterMode): Promise<CaseDocument[]> {
  if (dataAdapterMode === 'mock') {
    return caseDocumentFixtures
      .filter((d) => d.organizationId === organizationId && d.caseId === caseId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  const response = await queryWixDataItems<WixCaseDocumentItem>('caseDocuments', {
    filter: { organizationId, caseId },
  });
  return response.dataItems
    .map((item) => mapWixCaseDocumentItem(item.data))
    .filter((d): d is CaseDocument => d !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function nextDocumentVersion(organizationId: string, caseId: string, templateId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  const existing = await list(organizationId, caseId, dataAdapterMode);
  const forTemplate = existing.filter((d) => d.templateId === templateId);
  if (forTemplate.length === 0) return 1;
  return Math.max(...forTemplate.map((d) => d.version ?? 0)) + 1;
}

/** Generates a document from a template — a regeneration is the same
    function, distinguished only by `params.existingDocumentId` being
    set (the row it names is superseded once the new row is active).
    `params.templateVersion` is the explicit-choice override (Invariant):
    omitted resolves to the template's current latest version. */
export async function generate(
  params: NewGeneratedDocumentInput & { idFactory: () => string; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseDocument> {
  const template = await getTemplate(ctx.organizationId, params.templateId, dataAdapterMode);
  if (!template) {
    throw new DocumentServiceError('Document template not found.');
  }
  const version = params.templateVersion !== undefined ? template.versions.find((v) => v.version === params.templateVersion) : getActiveVersion(template);
  if (!version) {
    throw new DocumentServiceError(`Template version ${params.templateVersion} not found.`);
  }

  /** Phase 26 (Electronic Signatures & Authorization Workflows). A signed
      document is permanently locked — this is the sole mechanism for
      that invariant. A correction is always a brand-new, unrelated
      `generate()` call (no `existingDocumentId`) plus a new signature
      request; the signed original's `status` is never flipped to
      `superseded`, never modified, never invalidated. */
  if (params.existingDocumentId) {
    const existingDocuments = await list(ctx.organizationId, params.caseId, dataAdapterMode);
    const existingTarget = existingDocuments.find((d) => d.id === params.existingDocumentId);
    if (existingTarget?.signatureStatus === 'signed') {
      throw new DocumentServiceError('Cannot regenerate a signed document — it is permanently locked. Generate a new, independent document and create a new signature request instead.');
    }
  }

  const mergeSource = await resolveMergeSourceData(ctx.organizationId, params.caseId, dataAdapterMode);
  const resolvedFields = resolveMergeContext(mergeSource);
  const mergedHtml = mergeTemplate(version.body, resolvedFields);

  const documentId = params.idFactory();
  const nowIsoValue = params.now ?? nowIso();
  const docVersion = await nextDocumentVersion(ctx.organizationId, params.caseId, params.templateId, dataAdapterMode);

  const pendingDocument: CaseDocument = {
    id: documentId,
    organizationId: ctx.organizationId,
    caseId: params.caseId,
    origin: 'generated',
    documentTypeKey: template.documentTypeKey,
    category: template.category,
    fileName: `${template.name}.pdf`,
    mimeType: 'application/pdf',
    fileSizeBytes: 0,
    checksumSha256: '',
    storageKey: '',
    status: 'pending',
    templateId: params.templateId,
    templateVersion: version.version,
    version: docVersion,
    supersedesId: params.existingDocumentId ?? null,
    signatureStatus: null,
    generatedBy: ctx.actorIdentityId,
    uploadedBy: null,
    createdAt: nowIsoValue,
    correlationId: ctx.correlationId,
  };
  await persistPendingDocument(pendingDocument, dataAdapterMode);

  let finalDocument: CaseDocument;
  try {
    const pdfBuffer = await documentRenderer.renderHtmlToPdf(wrapMergedHtmlDocument(mergedHtml));
    const checksumSha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
    const storageKey = `${ctx.organizationId}/${params.caseId}/${documentId}.pdf`;
    const { storageKey: finalStorageKey } = await documentStorageProvider.uploadFile(storageKey, pdfBuffer, 'application/pdf');
    finalDocument = await completeDocumentGeneration(
      ctx.organizationId,
      documentId,
      { status: 'active', storageKey: finalStorageKey, checksumSha256, fileSizeBytes: pdfBuffer.length },
      dataAdapterMode,
    );
  } catch (error) {
    await completeDocumentGeneration(ctx.organizationId, documentId, { status: 'failed', storageKey: '', checksumSha256: '', fileSizeBytes: 0 }, dataAdapterMode);
    throw new DocumentServiceError(`Document generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (params.existingDocumentId) {
    await updateDocumentStatus(ctx.organizationId, params.existingDocumentId, 'superseded', dataAdapterMode);
    try {
      await recordDocumentRegenerated(ctx, params.caseId, documentId, params.existingDocumentId, version.version, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record document.regenerated activity event:', error instanceof Error ? error.message : error);
    }
  } else {
    try {
      await recordDocumentGenerated(ctx, params.caseId, documentId, params.templateId, version.version, template.name, dataAdapterMode);
    } catch (error) {
      console.error('Failed to record document.generated activity event:', error instanceof Error ? error.message : error);
    }
  }

  return finalDocument;
}

export async function upload(
  params: NewUploadedDocumentInput & { idFactory: () => string; now?: string },
  fileBuffer: Buffer,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<CaseDocument> {
  const documentId = params.idFactory();
  const nowIsoValue = params.now ?? nowIso();
  const checksumSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const storageKey = `${ctx.organizationId}/${params.caseId}/${documentId}-${params.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const document: CaseDocument = {
    id: documentId,
    organizationId: ctx.organizationId,
    caseId: params.caseId,
    origin: 'uploaded',
    documentTypeKey: params.documentTypeKey ?? null,
    category: params.category ?? null,
    fileName: params.fileName,
    mimeType: params.mimeType,
    fileSizeBytes: 0,
    checksumSha256: '',
    storageKey: '',
    status: 'pending',
    templateId: null,
    templateVersion: null,
    version: null,
    supersedesId: null,
    signatureStatus: null,
    generatedBy: null,
    uploadedBy: ctx.actorIdentityId,
    createdAt: nowIsoValue,
    correlationId: ctx.correlationId,
  };
  await persistPendingDocument(document, dataAdapterMode);

  let finalDocument: CaseDocument;
  try {
    const { storageKey: finalStorageKey } = await documentStorageProvider.uploadFile(storageKey, fileBuffer, params.mimeType);
    finalDocument = await completeDocumentGeneration(
      ctx.organizationId,
      documentId,
      { status: 'active', storageKey: finalStorageKey, checksumSha256, fileSizeBytes: fileBuffer.length },
      dataAdapterMode,
    );
  } catch (error) {
    await completeDocumentGeneration(ctx.organizationId, documentId, { status: 'failed', storageKey: '', checksumSha256: '', fileSizeBytes: 0 }, dataAdapterMode);
    throw new DocumentServiceError(`Document upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    await recordDocumentUploaded(ctx, params.caseId, documentId, params.fileName, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.uploaded activity event:', error instanceof Error ? error.message : error);
  }

  return finalDocument;
}

export async function archive(organizationId: string, caseId: string, documentId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<void> {
  const documents = await list(organizationId, caseId, dataAdapterMode);
  const target = documents.find((d) => d.id === documentId);
  if (!target) {
    throw new DocumentServiceError('Document not found.');
  }
  await updateDocumentStatus(organizationId, documentId, 'archived', dataAdapterMode);
  try {
    await recordDocumentArchived(ctx, caseId, documentId, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.archived activity event:', error instanceof Error ? error.message : error);
  }
}

/** The only path that ever touches storage bytes for a download — always
    called from inside the download Route Handler, after it has already
    re-checked authorization; never exposes a storage URL to the browser
    (see lib/documentStorageProvider.ts's own header comment). Records
    `document.downloaded` best-effort, matching every other action here. */
export async function downloadFile(
  organizationId: string,
  caseId: string,
  documentId: string,
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  const documents = await list(organizationId, caseId, dataAdapterMode);
  const target = documents.find((d) => d.id === documentId);
  if (!target || target.status === 'pending' || target.status === 'failed') {
    throw new DocumentServiceError('Document not found or not available for download.');
  }

  const { buffer, contentType } = await documentStorageProvider.downloadFile(target.storageKey);

  try {
    await recordDocumentDownloaded(ctx, caseId, documentId, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.downloaded activity event:', error instanceof Error ? error.message : error);
  }

  return { buffer, contentType, fileName: target.fileName };
}
