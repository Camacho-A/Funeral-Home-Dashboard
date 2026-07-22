import type { StageTemplate, IntakeTemplate, WorkflowTemplate, WorkflowTemplateVersion } from '../types/workflowTemplate';

/**
 * Phase 15B (Wix Workflow Template Read Integration). Mirrors
 * lib/wixOrganizationMapper.ts's role exactly: the one place raw Wix Data
 * item shapes are ever touched for workflow templates. Wix Data splits
 * template identity and version identity into two separate collections
 * (`workflowTemplates`, `workflowTemplateVersions` — see Phase 14A's
 * docs/WIX_DATA_SCHEMA.md and ADR-009), while the domain type
 * (types/workflowTemplate.ts's WorkflowTemplate) keeps versions nested
 * inline, exactly like every mock fixture already does. buildWorkflowTemplate
 * below is what re-joins the two collections back into that one nested
 * shape server-side — no caller (services/workflowTemplatesService.ts and
 * everything above it) ever sees the two-collection split.
 *
 * Identifier handling (documented per Phase 15B's explicit requirement):
 * - Wix item `_id` (both collections): never read, never used as a Beacon
 *   id or display name.
 * - `workflowTemplates.beaconTemplateId` → WorkflowTemplate.id.
 * - `workflowTemplates.organizationId` → WorkflowTemplate.organizationId.
 * - `workflowTemplateVersions.beaconTemplateId` → the foreign key joining a
 *   version row to its template; matched against the template's own
 *   beaconTemplateId, never assumed to be positionally aligned.
 * - There is no "Beacon workflow template version ID" — WorkflowTemplateVersion
 *   has no id field in the domain model (types/workflowTemplate.ts), and none
 *   is invented here. A version is identified structurally by
 *   (templateId, version number) only, matching every mock fixture.
 * - There is no "current" or "published" version concept anywhere in the
 *   existing domain model — only "latest", resolved positionally
 *   (domain/workflow/snapshot.ts's latestTemplateVersion:
 *   `versions[versions.length - 1]`). This mapper preserves that exact
 *   semantic by sorting assembled versions ascending by `version` number
 *   before returning them, rather than inventing a "published"/"current"
 *   precedence rule that doesn't exist in the mock model either.
 */

export type WixWorkflowTemplateItem = {
  beaconTemplateId?: unknown;
  organizationId?: unknown;
  isSystemTemplate?: unknown;
  name?: unknown;
  isEnabled?: unknown;
  caseTypes?: unknown;
};

export type WixWorkflowTemplateVersionItem = {
  beaconTemplateId?: unknown;
  version?: unknown;
  caseTypes?: unknown;
  stages?: unknown;
  intake?: unknown;
  createdAt?: unknown;
};

/** A validated template record, still missing its `versions` array — see buildWorkflowTemplate. */
export type WixWorkflowTemplateSummary = {
  id: string;
  organizationId: string;
  name: string;
  isEnabled: boolean;
  caseTypes: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Validates and maps one `workflowTemplates` Wix item. Deliberately does
 * NOT validate the shape of `stages`/`intake` inside caseTypes — those
 * live entirely in the version collection and are validated by
 * mapWixWorkflowTemplateVersionItem instead.
 */
export function mapWixWorkflowTemplateItem(item: WixWorkflowTemplateItem | undefined): WixWorkflowTemplateSummary | null {
  if (
    !item ||
    typeof item.beaconTemplateId !== 'string' ||
    typeof item.organizationId !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.isEnabled !== 'boolean' ||
    !isStringArray(item.caseTypes)
  ) {
    return null;
  }

  return {
    id: item.beaconTemplateId,
    organizationId: item.organizationId,
    name: item.name,
    isEnabled: item.isEnabled,
    caseTypes: item.caseTypes,
  };
}

/**
 * Validates and maps one `workflowTemplateVersions` Wix item.
 * `stages`/`intake` are validated only as "present and the right container
 * type" (array / object) — not deep-validated field-by-field, matching
 * this phase's scope ("do not mutate or normalize workflow content in a
 * way that changes the meaning of the snapshot"): the content is passed
 * through as-is once it's confirmed to be shaped like a stages array /
 * intake object, not re-derived or reinterpreted.
 */
export function mapWixWorkflowTemplateVersionItem(
  item: WixWorkflowTemplateVersionItem | undefined,
): WorkflowTemplateVersion | null {
  if (
    !item ||
    typeof item.beaconTemplateId !== 'string' ||
    typeof item.version !== 'number' ||
    !isStringArray(item.caseTypes) ||
    !Array.isArray(item.stages) ||
    typeof item.intake !== 'object' ||
    item.intake === null ||
    typeof item.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    version: item.version,
    caseTypes: item.caseTypes,
    stages: item.stages as StageTemplate[],
    intake: item.intake as IntakeTemplate,
    createdAt: item.createdAt,
  };
}

/**
 * Re-joins a validated template summary with its validated version items
 * into the exact nested WorkflowTemplate shape every mock fixture already
 * has. Versions are sorted ascending by `version` number — the
 * `versions[versions.length - 1]` == latest convention every existing
 * consumer (domain/workflow/snapshot.ts, NewCaseModal.tsx) already relies
 * on continues to hold regardless of the order Wix returned rows in.
 *
 * Returns null if there are zero valid versions — a template with no
 * usable versions is excluded from results entirely (see the Route
 * Handler), rather than returned with an empty `versions: []` that would
 * only defer a crash to whenever a consumer calls latestTemplateVersion().
 */
export function buildWorkflowTemplate(
  summary: WixWorkflowTemplateSummary,
  versions: WorkflowTemplateVersion[],
): WorkflowTemplate | null {
  if (versions.length === 0) {
    return null;
  }

  const sortedVersions = [...versions].sort((a, b) => a.version - b.version);

  return {
    id: summary.id,
    organizationId: summary.organizationId,
    name: summary.name,
    isEnabled: summary.isEnabled,
    caseTypes: summary.caseTypes,
    versions: sortedVersions,
  };
}
