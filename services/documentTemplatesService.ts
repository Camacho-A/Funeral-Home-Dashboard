import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, updateWixDataItem, insertWixDataItem } from '../lib/wixDataApi';
import {
  buildWixDocumentTemplateData,
  buildWixDocumentTemplateVersionData,
  applyDocumentTemplateStatusToWixData,
  fetchWixDocumentTemplates,
  fetchWixDocumentTemplateById,
  type WixDocumentTemplateItem,
} from '../lib/wixDocumentTemplateMapper';
import type { DocumentTemplate, DocumentTemplateCategory, DocumentTemplateStatus, DocumentTemplateVersion } from '../types/documentTemplate';
import { isValidDocumentTypeKey } from '../domain/documents/documentTypeRegistry';
import { validateMergeTokens, mergeTemplate, resolveMergeContext, extractMergeTokens, type MergeSourceData } from '../domain/documents/mergeEngine';
import { sanitizeTemplateBody } from '../domain/documents/sanitizeTemplateBody';
import {
  recordDocumentTemplateCreated,
  recordDocumentTemplateUpdated,
  recordDocumentTemplateArchived,
  recordDocumentTemplateRestored,
  type ActivityContext,
} from './activityService';
import { documentTemplateFixtures } from './__mocks__/documentFixtures';

/**
 * Phase 25 (Document Generation & Template Management). Template
 * CRUD/versioning only — mirrors `services/workflowTemplatesService.ts`'s
 * *actual* persistence-layer shape (the two-collection join/split lives
 * in `lib/wixDocumentTemplateMapper.ts`, exactly like
 * `lib/wixWorkflowTemplateMapper.ts` does for workflow templates) rather
 * than that file's own client-fetch-based shape — this service is called
 * directly by Route Handlers (like `services/pricingService.ts` /
 * `services/roleService.ts`), never fetched from the browser, since
 * `services/documentService.ts` (generation orchestration) needs to call
 * it directly server-side. Generation/rendering/storage/activity
 * orchestration for *generated documents* lives in
 * `services/documentService.ts`, not here — this file only ever manages
 * template identity and versions.
 *
 * **Invariant**: a template version, once created, is never edited or
 * deleted — every write below is an insert (a new version, or a new
 * template's first version); the only *update* this file ever performs
 * is a `documentTemplates` row's `status` field (archive/restore).
 */

export class DocumentTemplateServiceError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

/** The latest version is always `versions[versions.length - 1]` — same
    convention as `WorkflowTemplate`; a `DocumentTemplate` is never
    returned with zero versions (see the mapper's own `buildDocumentTemplate`),
    so this is total, not partial. */
export function getActiveVersion(template: DocumentTemplate): DocumentTemplateVersion {
  return template.versions[template.versions.length - 1];
}

function validateAndSanitizeBody(body: string): string {
  const sanitized = sanitizeTemplateBody(body);
  const { valid, unknownTokens } = validateMergeTokens(sanitized);
  if (!valid) {
    throw new DocumentTemplateServiceError(`Template body references unrecognized merge field(s): ${unknownTokens.join(', ')}`);
  }
  return sanitized;
}

async function persistNewTemplate(template: DocumentTemplate, firstVersion: DocumentTemplateVersion, dataAdapterMode: DataAdapterMode): Promise<DocumentTemplate> {
  const full: DocumentTemplate = { ...template, versions: [firstVersion] };
  if (dataAdapterMode === 'mock') {
    documentTemplateFixtures.push(full);
    return full;
  }
  await insertWixDataItem<WixDocumentTemplateItem>('documentTemplates', buildWixDocumentTemplateData(template), template.id);
  await insertWixDataItem('documentTemplateVersions', buildWixDocumentTemplateVersionData(firstVersion), `${template.id}-v${firstVersion.version}`);
  return full;
}

async function persistNewVersion(version: DocumentTemplateVersion, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = documentTemplateFixtures.findIndex((t) => t.id === version.templateId);
    if (index !== -1) {
      documentTemplateFixtures[index] = { ...documentTemplateFixtures[index], versions: [...documentTemplateFixtures[index].versions, version] };
    }
    return;
  }
  await insertWixDataItem('documentTemplateVersions', buildWixDocumentTemplateVersionData(version), `${version.templateId}-v${version.version}`);
}

async function updateTemplateStatus(organizationId: string, templateId: string, status: DocumentTemplateStatus, dataAdapterMode: DataAdapterMode): Promise<void> {
  if (dataAdapterMode === 'mock') {
    const index = documentTemplateFixtures.findIndex((t) => t.id === templateId && t.organizationId === organizationId);
    if (index !== -1) documentTemplateFixtures[index] = { ...documentTemplateFixtures[index], status };
    return;
  }
  const response = await queryWixDataItems<WixDocumentTemplateItem>('documentTemplates', {
    filter: { beaconTemplateId: templateId, organizationId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return;
  const merged = applyDocumentTemplateStatusToWixData(existingItem.data, status);
  await updateWixDataItem('documentTemplates', existingItem.id, merged);
}

export async function list(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<DocumentTemplate[]> {
  if (dataAdapterMode === 'mock') {
    return documentTemplateFixtures.filter((t) => t.organizationId === organizationId);
  }
  return fetchWixDocumentTemplates(organizationId);
}

export async function get(organizationId: string, templateId: string, dataAdapterMode: DataAdapterMode): Promise<DocumentTemplate | null> {
  if (dataAdapterMode === 'mock') {
    return documentTemplateFixtures.find((t) => t.id === templateId && t.organizationId === organizationId) ?? null;
  }
  return fetchWixDocumentTemplateById(organizationId, templateId);
}

export async function createTemplate(
  params: {
    organizationId: string;
    name: string;
    documentTypeKey: string;
    category: DocumentTemplateCategory;
    body: string;
    idFactory: () => string;
    now?: string;
  },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<DocumentTemplate> {
  if (!isValidDocumentTypeKey(params.documentTypeKey)) {
    throw new DocumentTemplateServiceError(`Unrecognized document type key: "${params.documentTypeKey}".`);
  }
  const sanitizedBody = validateAndSanitizeBody(params.body);

  const templateId = params.idFactory();
  const nowIsoValue = params.now ?? nowIso();
  const template: DocumentTemplate = {
    id: templateId,
    organizationId: params.organizationId,
    isSystemTemplate: false,
    name: params.name,
    documentTypeKey: params.documentTypeKey,
    category: params.category,
    status: 'active',
    versions: [],
  };
  const firstVersion: DocumentTemplateVersion = {
    templateId,
    version: 1,
    body: sanitizedBody,
    mergeFieldsUsed: extractMergeTokens(sanitizedBody),
    createdAt: nowIsoValue,
    createdBy: ctx.actorIdentityId ?? 'unknown',
  };

  const persisted = await persistNewTemplate(template, firstVersion, dataAdapterMode);

  try {
    await recordDocumentTemplateCreated(ctx, templateId, params.name, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.template.created activity event:', error instanceof Error ? error.message : error);
  }

  return persisted;
}

export async function createVersion(
  params: { organizationId: string; templateId: string; body: string; idFactory: () => string; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<DocumentTemplate> {
  const existing = await get(params.organizationId, params.templateId, dataAdapterMode);
  if (!existing) {
    throw new DocumentTemplateServiceError('Document template not found.');
  }
  const sanitizedBody = validateAndSanitizeBody(params.body);
  const nextVersionNumber = getActiveVersion(existing).version + 1;
  const version: DocumentTemplateVersion = {
    templateId: params.templateId,
    version: nextVersionNumber,
    body: sanitizedBody,
    mergeFieldsUsed: extractMergeTokens(sanitizedBody),
    createdAt: params.now ?? nowIso(),
    createdBy: ctx.actorIdentityId ?? 'unknown',
  };

  await persistNewVersion(version, dataAdapterMode);

  try {
    await recordDocumentTemplateUpdated(ctx, params.templateId, nextVersionNumber, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.template.updated activity event:', error instanceof Error ? error.message : error);
  }

  return { ...existing, versions: [...existing.versions, version] };
}

/** Duplicates a template's current latest version's body into a
    brand-new, independent template (version 1) — the source template is
    never modified, matching `services/roleService.ts`'s `cloneRole()`
    exactly. */
export async function cloneTemplate(
  params: { organizationId: string; sourceTemplateId: string; name: string; idFactory: () => string; now?: string },
  ctx: ActivityContext,
  dataAdapterMode: DataAdapterMode,
): Promise<DocumentTemplate> {
  const source = await get(params.organizationId, params.sourceTemplateId, dataAdapterMode);
  if (!source) {
    throw new DocumentTemplateServiceError('Source document template not found.');
  }
  const sourceVersion = getActiveVersion(source);

  const templateId = params.idFactory();
  const nowIsoValue = params.now ?? nowIso();
  const template: DocumentTemplate = {
    id: templateId,
    organizationId: params.organizationId,
    isSystemTemplate: false,
    name: params.name,
    documentTypeKey: source.documentTypeKey,
    category: source.category,
    status: 'active',
    versions: [],
  };
  const firstVersion: DocumentTemplateVersion = {
    templateId,
    version: 1,
    body: sourceVersion.body,
    mergeFieldsUsed: sourceVersion.mergeFieldsUsed,
    createdAt: nowIsoValue,
    createdBy: ctx.actorIdentityId ?? 'unknown',
  };

  const persisted = await persistNewTemplate(template, firstVersion, dataAdapterMode);

  try {
    await recordDocumentTemplateCreated(ctx, templateId, params.name, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.template.created activity event:', error instanceof Error ? error.message : error);
  }

  return persisted;
}

export async function archiveTemplate(organizationId: string, templateId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<void> {
  const existing = await get(organizationId, templateId, dataAdapterMode);
  if (!existing) {
    throw new DocumentTemplateServiceError('Document template not found.');
  }
  await updateTemplateStatus(organizationId, templateId, 'archived', dataAdapterMode);
  try {
    await recordDocumentTemplateArchived(ctx, templateId, existing.name, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.template.archived activity event:', error instanceof Error ? error.message : error);
  }
}

export async function restoreTemplate(organizationId: string, templateId: string, ctx: ActivityContext, dataAdapterMode: DataAdapterMode): Promise<void> {
  const existing = await get(organizationId, templateId, dataAdapterMode);
  if (!existing) {
    throw new DocumentTemplateServiceError('Document template not found.');
  }
  await updateTemplateStatus(organizationId, templateId, 'active', dataAdapterMode);
  try {
    await recordDocumentTemplateRestored(ctx, templateId, existing.name, dataAdapterMode);
  } catch (error) {
    console.error('Failed to record document.template.restored activity event:', error instanceof Error ? error.message : error);
  }
}

/** Server-side merge preview — no rendering, no storage, no persistence.
    Used by the Template Editor's live preview and the `/preview` route. */
export function previewTemplate(body: string, source: MergeSourceData): string {
  const resolved = resolveMergeContext(source);
  return mergeTemplate(body, resolved);
}

