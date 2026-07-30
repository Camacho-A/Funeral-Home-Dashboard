import type { DocumentTemplate, DocumentTemplateCategory, DocumentTemplateStatus, DocumentTemplateVersion } from '../types/documentTemplate';
import { queryWixDataItems } from './wixDataApi';

/**
 * Phase 25 (Document Generation & Template Management). Mirrors
 * `lib/wixWorkflowTemplateMapper.ts`'s exact structure: template identity
 * (`documentTemplates`) and version identity (`documentTemplateVersions`)
 * are two separate Wix collections, joined back into one nested
 * `DocumentTemplate` shape here — the only place either collection's raw
 * item shape is ever touched. No caller above this file (
 * `services/documentTemplatesService.ts` and up) ever sees the split.
 *
 * Identifier handling, matching the workflow-template precedent exactly:
 * - Wix item `_id` (both collections): never read as a Beacon id.
 * - `documentTemplates.beaconTemplateId` → `DocumentTemplate.id`.
 * - `documentTemplateVersions.beaconTemplateId` → the foreign key joining
 *   a version row to its template, matched by value, never position.
 * - A version has no id of its own — identified structurally by
 *   `(templateId, version number)`, matching `WorkflowTemplateVersion`.
 * - "Latest" is `versions[versions.length - 1]` after ascending sort by
 *   `version` — there is no separate "published"/"current" concept.
 */

export type WixDocumentTemplateItem = {
  beaconTemplateId?: unknown;
  organizationId?: unknown;
  isSystemTemplate?: unknown;
  name?: unknown;
  documentTypeKey?: unknown;
  category?: unknown;
  status?: unknown;
};

export type WixDocumentTemplateVersionItem = {
  beaconTemplateId?: unknown;
  version?: unknown;
  body?: unknown;
  mergeFieldsUsed?: unknown;
  createdAt?: unknown;
  createdBy?: unknown;
};

export type WixDocumentTemplateSummary = {
  id: string;
  organizationId: string | null;
  isSystemTemplate: boolean;
  name: string;
  documentTypeKey: string;
  category: DocumentTemplateCategory;
  status: DocumentTemplateStatus;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

const VALID_CATEGORIES: readonly string[] = [
  'contract',
  'authorization',
  'cremation_form',
  'burial_form',
  'financial',
  'receipt',
  'statement',
  'letter',
  'internal_form',
  'miscellaneous',
];

function isDocumentTemplateCategory(value: unknown): value is DocumentTemplateCategory {
  return typeof value === 'string' && VALID_CATEGORIES.includes(value);
}

function isDocumentTemplateStatus(value: unknown): value is DocumentTemplateStatus {
  return value === 'active' || value === 'archived';
}

export function mapWixDocumentTemplateItem(item: WixDocumentTemplateItem | undefined): WixDocumentTemplateSummary | null {
  if (
    !item ||
    typeof item.beaconTemplateId !== 'string' ||
    typeof item.isSystemTemplate !== 'boolean' ||
    typeof item.name !== 'string' ||
    typeof item.documentTypeKey !== 'string' ||
    !isDocumentTemplateCategory(item.category) ||
    !isDocumentTemplateStatus(item.status) ||
    (item.organizationId !== null && typeof item.organizationId !== 'string')
  ) {
    return null;
  }

  return {
    id: item.beaconTemplateId,
    organizationId: (item.organizationId as string | null) ?? null,
    isSystemTemplate: item.isSystemTemplate,
    name: item.name,
    documentTypeKey: item.documentTypeKey,
    category: item.category,
    status: item.status,
  };
}

export function mapWixDocumentTemplateVersionItem(item: WixDocumentTemplateVersionItem | undefined): DocumentTemplateVersion | null {
  if (
    !item ||
    typeof item.beaconTemplateId !== 'string' ||
    typeof item.version !== 'number' ||
    typeof item.body !== 'string' ||
    !isStringArray(item.mergeFieldsUsed) ||
    typeof item.createdAt !== 'string' ||
    typeof item.createdBy !== 'string'
  ) {
    return null;
  }

  return {
    templateId: item.beaconTemplateId,
    version: item.version,
    body: item.body,
    mergeFieldsUsed: item.mergeFieldsUsed,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
  };
}

/** Re-joins a validated template summary with its validated version
    items — see the header comment. Returns null if there are zero valid
    versions, matching `buildWorkflowTemplate`'s exact precedent (a
    template with no usable versions is excluded entirely, rather than
    returned with `versions: []`, which would only defer a crash to
    whenever a consumer resolves "the latest version"). */
export function buildDocumentTemplate(summary: WixDocumentTemplateSummary, versions: DocumentTemplateVersion[]): DocumentTemplate | null {
  if (versions.length === 0) {
    return null;
  }
  const sortedVersions = [...versions].sort((a, b) => a.version - b.version);
  return {
    id: summary.id,
    organizationId: summary.organizationId,
    isSystemTemplate: summary.isSystemTemplate,
    name: summary.name,
    documentTypeKey: summary.documentTypeKey,
    category: summary.category,
    status: summary.status,
    versions: sortedVersions,
  };
}

export function buildWixDocumentTemplateData(template: {
  id: string;
  organizationId: string | null;
  isSystemTemplate: boolean;
  name: string;
  documentTypeKey: string;
  category: DocumentTemplateCategory;
  status: DocumentTemplateStatus;
}): WixDocumentTemplateItem {
  return {
    beaconTemplateId: template.id,
    organizationId: template.organizationId,
    isSystemTemplate: template.isSystemTemplate,
    name: template.name,
    documentTypeKey: template.documentTypeKey,
    category: template.category,
    status: template.status,
  };
}

/** Append-only — the only caller (`services/documentTemplatesService.ts`)
    only ever inserts a version row, never updates/deletes one, matching
    `workflowTemplateVersions`' exact immutability discipline. */
export function buildWixDocumentTemplateVersionData(version: DocumentTemplateVersion): WixDocumentTemplateVersionItem {
  return {
    beaconTemplateId: version.templateId,
    version: version.version,
    body: version.body,
    mergeFieldsUsed: version.mergeFieldsUsed,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
  };
}

/** The only mutable field on a `documentTemplates` row (identity-only,
    never version content): `status`, for archive/restore. */
export function applyDocumentTemplateStatusToWixData(existing: WixDocumentTemplateItem, status: DocumentTemplateStatus): WixDocumentTemplateItem {
  return { ...existing, status };
}

/** Fetches every organization-owned template (mirrors
    `fetchWixWorkflowTemplates`) plus, when `includeSystemTemplates` is
    set, any `isSystemTemplate: true` row — no system templates are
    seeded this phase, but the read path supports them from day one so a
    future phase adding one needs no mapper change. */
export async function fetchWixDocumentTemplates(organizationId: string): Promise<DocumentTemplate[]> {
  const templatesResponse = await queryWixDataItems<WixDocumentTemplateItem>('documentTemplates', {
    filter: { organizationId },
  });

  const summaries = templatesResponse.dataItems.map((item) => mapWixDocumentTemplateItem(item.data)).filter((summary) => summary !== null);

  const templates = await Promise.all(
    summaries.map(async (summary) => {
      const versionsResponse = await queryWixDataItems<WixDocumentTemplateVersionItem>('documentTemplateVersions', {
        filter: { beaconTemplateId: summary.id },
      });
      const versions = versionsResponse.dataItems.map((item) => mapWixDocumentTemplateVersionItem(item.data)).filter((version) => version !== null);
      return buildDocumentTemplate(summary, versions);
    }),
  );

  return templates.filter((template) => template !== null);
}

export async function fetchWixDocumentTemplateById(organizationId: string, templateId: string): Promise<DocumentTemplate | null> {
  const templatesResponse = await queryWixDataItems<WixDocumentTemplateItem>('documentTemplates', {
    filter: { beaconTemplateId: templateId, organizationId },
    paging: { limit: 1 },
  });

  const summary = mapWixDocumentTemplateItem(templatesResponse.dataItems[0]?.data);
  if (!summary) {
    return null;
  }

  const versionsResponse = await queryWixDataItems<WixDocumentTemplateVersionItem>('documentTemplateVersions', {
    filter: { beaconTemplateId: summary.id },
  });
  const versions = versionsResponse.dataItems.map((item) => mapWixDocumentTemplateVersionItem(item.data)).filter((version) => version !== null);

  return buildDocumentTemplate(summary, versions);
}
