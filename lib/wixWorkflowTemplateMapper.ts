import type {
  StageTemplate,
  ChecklistItemTemplate,
  IntakeTemplate,
  IntakeFieldTemplate,
  IntakeSectionTemplate,
  WorkflowCompletionPolicy,
  WorkflowTemplate,
  WorkflowTemplateVersion,
  WorkflowComposition,
  WorkflowVersionSource,
} from '../types/workflowTemplate';
import { queryWixDataItems } from './wixDataApi';
import { findForbiddenPaymentFields } from './paymentFieldGuard';
import { parseCompletionPolicy } from '../domain/workflow/completionPolicy';

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
  /** Service-specific workflows (2026-10). Optional — absent on every row
      created before this field existed; read leniently (see below). */
  serviceTypeCodes?: unknown;
  description?: unknown;
};

export type WixWorkflowTemplateVersionItem = {
  beaconTemplateId?: unknown;
  version?: unknown;
  caseTypes?: unknown;
  stages?: unknown;
  intake?: unknown;
  createdAt?: unknown;
  /** Service-based workflows (2026-11). Optional; absent on every Manors row. */
  serviceTypeCodes?: unknown;
  composition?: unknown;
  /** Service-specific workflows (2026-10). Optional; absent = approved. */
  status?: unknown;
  approvedBy?: unknown;
  approvedAt?: unknown;
  /** Workflow template editor (2026-10). Optional; absent on older rows. */
  createdBy?: unknown;
  createdByName?: unknown;
  approvedByName?: unknown;
  /** Service-specific completion (2026-10). Optional objects; absent on
      every older row (absent policy = today's completion rule). */
  completionPolicy?: unknown;
  derivedFrom?: unknown;
};

/** A validated template record, still missing its `versions` array — see buildWorkflowTemplate. */
export type WixWorkflowTemplateSummary = {
  id: string;
  organizationId: string;
  name: string;
  isEnabled: boolean;
  caseTypes: string[];
  serviceTypeCodes?: string[];
  description?: string | null;
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
    // Service-specific workflows (2026-10): lenient — a missing or
    // malformed value is simply absent (the template serves no service
    // type), never a reason to drop the whole template row.
    ...(isStringArray(item.serviceTypeCodes) ? { serviceTypeCodes: item.serviceTypeCodes } : {}),
    ...(typeof item.description === 'string' ? { description: item.description } : {}),
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

  const composition = parseComposition(item.composition);
  return {
    version: item.version,
    caseTypes: item.caseTypes,
    stages: item.stages as StageTemplate[],
    intake: item.intake as IntakeTemplate,
    createdAt: item.createdAt,
    ...(isStringArray(item.serviceTypeCodes) && item.serviceTypeCodes.length > 0 ? { serviceTypeCodes: item.serviceTypeCodes } : {}),
    ...(composition ? { composition } : {}),
    // Service-specific workflows (2026-10). Only an explicit 'draft' is a
    // draft; absent or any unrecognized value reads as before (approved),
    // so no existing row changes meaning.
    ...(item.status === 'draft' || item.status === 'approved' ? { status: item.status } : {}),
    ...(typeof item.approvedBy === 'string' ? { approvedBy: item.approvedBy } : {}),
    ...(typeof item.approvedAt === 'string' ? { approvedAt: item.approvedAt } : {}),
    // Workflow template editor (2026-10): lenient like the fields above —
    // malformed values are simply absent, never a reason to drop the row.
    ...(typeof item.createdBy === 'string' ? { createdBy: item.createdBy } : {}),
    ...(typeof item.createdByName === 'string' ? { createdByName: item.createdByName } : {}),
    ...(typeof item.approvedByName === 'string' ? { approvedByName: item.approvedByName } : {}),
    // Service-specific completion (2026-10). Same leniency: a policy that
    // fails its shape check is ABSENT (today's rule), never a dropped row
    // — the version's approval re-validates whatever is stored.
    ...(() => {
      if (item.completionPolicy === undefined || item.completionPolicy === null) return {};
      const { policy } = parseCompletionPolicy(item.completionPolicy);
      return policy ? { completionPolicy: policy } : {};
    })(),
    ...(isVersionSource(item.derivedFrom) ? { derivedFrom: { templateId: item.derivedFrom.templateId, version: item.derivedFrom.version } } : {}),
  };
}

/** A recorded base-plus-extensions composition, or null when absent or malformed. */
function parseComposition(value: unknown): WorkflowComposition | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as { base?: { key?: unknown; version?: unknown }; extensions?: unknown };
  const isRef = (r: unknown): r is { key: string; version: number } =>
    typeof r === 'object' && r !== null && typeof (r as { key?: unknown }).key === 'string' && typeof (r as { version?: unknown }).version === 'number';
  if (!isRef(v.base) || !Array.isArray(v.extensions) || !v.extensions.every(isRef)) return null;
  return { base: { key: v.base.key, version: v.base.version }, extensions: v.extensions.map((e) => ({ key: e.key, version: e.version })) };
}

function isVersionSource(value: unknown): value is WorkflowVersionSource {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).templateId === 'string' &&
    typeof (value as Record<string, unknown>).version === 'number'
  );
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
    ...(summary.serviceTypeCodes ? { serviceTypeCodes: summary.serviceTypeCodes } : {}),
    ...(summary.description !== undefined ? { description: summary.description } : {}),
  };
}

/**
 * Phase 15B (originally inline in app/api/workflow-templates/route.ts,
 * moved here in Phase 16 so app/api/cases/route.ts's case-create handler
 * can reuse the exact same join logic when independently resolving an
 * organization's enabled workflow template server-side, rather than
 * duplicating it). Queries `workflowTemplates` filtered by organizationId,
 * then joins each with its `workflowTemplateVersions` rows. A template
 * with zero valid versions is excluded; a malformed record is skipped.
 */
export async function fetchWixWorkflowTemplates(organizationId: string): Promise<WorkflowTemplate[]> {
  const templatesResponse = await queryWixDataItems<WixWorkflowTemplateItem>('workflowTemplates', {
    filter: { organizationId },
  });

  const summaries = templatesResponse.dataItems
    .map((item) => mapWixWorkflowTemplateItem(item.data))
    .filter((summary) => summary !== null);

  const templates = await Promise.all(
    summaries.map(async (summary) => {
      const versionsResponse = await queryWixDataItems<WixWorkflowTemplateVersionItem>('workflowTemplateVersions', {
        filter: { beaconTemplateId: summary.id },
      });
      const versions = versionsResponse.dataItems
        .map((item) => mapWixWorkflowTemplateVersionItem(item.data))
        .filter((version) => version !== null);

      return buildWorkflowTemplate(summary, versions);
    }),
  );

  return templates.filter((template) => template !== null);
}

/**
 * Phase 18 (Workflow Management). Fetches and joins exactly one template by
 * (organizationId, templateId), for both the existing single-template GET
 * route and the new create-version route below — extracted here (rather
 * than left inline in app/api/workflow-templates/[templateId]/route.ts, as
 * it was before this phase) so the two Route Handlers share one join
 * implementation instead of two copies, matching the precedent
 * fetchWixWorkflowTemplates already set in Phase 16 for the list endpoint.
 * Returns null on "not found, not this organization's, or malformed" —
 * the caller decides the HTTP status; this function never throws for those
 * cases, only for a genuine Wix connectivity failure.
 */
export async function fetchWixWorkflowTemplateById(
  organizationId: string,
  templateId: string,
): Promise<WorkflowTemplate | null> {
  const templatesResponse = await queryWixDataItems<WixWorkflowTemplateItem>('workflowTemplates', {
    filter: { beaconTemplateId: templateId, organizationId },
    paging: { limit: 1 },
  });

  const summary = mapWixWorkflowTemplateItem(templatesResponse.dataItems[0]?.data);
  if (!summary) {
    return null;
  }

  const versionsResponse = await queryWixDataItems<WixWorkflowTemplateVersionItem>('workflowTemplateVersions', {
    filter: { beaconTemplateId: summary.id },
  });
  const versions = versionsResponse.dataItems
    .map((item) => mapWixWorkflowTemplateVersionItem(item.data))
    .filter((version) => version !== null);

  return buildWorkflowTemplate(summary, versions);
}

/**
 * Phase 18 (Workflow Management). Runtime shape/type validation for an
 * admin's edited `stages` array — the DTO validation layer for the new
 * create-version endpoint, mirroring lib/wixCaseMapper.ts's
 * validateAndPickCaseUpdate in spirit (an untrusted HTTP JSON body gets no
 * compile-time protection) but deep, since a stage nests a checklist which
 * nests items. This only checks *shape* (right keys, right primitive
 * types) — the business invariants (sequential rawStage/index, non-empty
 * labels) are domain/workflow/editing.ts's validateStageSequencing's job,
 * run separately by the Route Handler after this passes. Returns `stages:
 * null` with a non-empty `errors` list on any failure, rather than
 * silently dropping bad fields — a malformed edit should be rejected
 * outright (400), never partially applied.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateChecklistItemPayload(value: unknown, path: string, errors: string[]): ChecklistItemTemplate | null {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  if (typeof value.index !== 'number') errors.push(`${path}.index must be a number.`);
  if (typeof value.label !== 'string') errors.push(`${path}.label must be a string.`);
  if (typeof value.hasField !== 'boolean') errors.push(`${path}.hasField must be a boolean.`);
  if (value.isPasswordField !== undefined && typeof value.isPasswordField !== 'boolean') {
    errors.push(`${path}.isPasswordField must be a boolean if present.`);
  }
  if (
    value.externalFormIntegrationId !== undefined &&
    value.externalFormIntegrationId !== null &&
    typeof value.externalFormIntegrationId !== 'string'
  ) {
    errors.push(`${path}.externalFormIntegrationId must be a string or null if present.`);
  }
  // Structured-field items (2026-10). This validator previously neither
  // checked nor returned `requiredCaseFields`, so the field was silently
  // dropped on every read of a persisted template. That is how live
  // template version 6 came to exist without it: v6 was created by
  // round-tripping v5 through this mapper, and v5's Certifier Information
  // item lost its ['certifierName', 'certifierPhone'] on the way through
  // — leaving every v6 Case with a frozen snapshot whose Certifier
  // Information item has no editable surface at all (hasField is false
  // and there are no required fields to render), which is exactly the
  // reported "certifier information is not showing" on First Call.
  const requiredCaseFieldsValid =
    value.requiredCaseFields === undefined ||
    (Array.isArray(value.requiredCaseFields) && value.requiredCaseFields.every((field) => typeof field === 'string'));
  if (!requiredCaseFieldsValid) {
    errors.push(`${path}.requiredCaseFields must be an array of strings if present.`);
  }

  // Time of Death fix (2026-10): `valueKind: 'time'` is carried through
  // below (it used to be dropped on every save). Any other value is dropped
  // rather than rejected — the behaviour Manors' saves already rely on.

  if (typeof value.index !== 'number' || typeof value.label !== 'string' || typeof value.hasField !== 'boolean') {
    return null;
  }
  // Every optional property is carried over exactly as given — present
  // when the item had it, absent when it did not — so a saved version
  // round-trips the editor's content field for field (the version you
  // review is the version you approve).
  return {
    index: value.index,
    label: value.label,
    hasField: value.hasField,
    ...(typeof value.isPasswordField === 'boolean' ? { isPasswordField: value.isPasswordField } : {}),
    // Always present (null when absent) — the shape every saved version,
    // Manors' included, has always had.
    externalFormIntegrationId: typeof value.externalFormIntegrationId === 'string' ? value.externalFormIntegrationId : null,
    ...(requiredCaseFieldsValid && Array.isArray(value.requiredCaseFields)
      ? { requiredCaseFields: [...(value.requiredCaseFields as string[])] }
      : {}),
    ...(value.valueKind === 'time' ? { valueKind: 'time' as const } : {}),
    // Shared workflow foundation (2026-11): an item's stable id survives
    // every save, so shared logic keeps finding it by id.
    ...(typeof value.stepId === 'string' && value.stepId.trim() !== '' ? { stepId: value.stepId } : {}),
  };
}

function validateStagePayload(value: unknown, path: string, errors: string[]): StageTemplate | null {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  if (typeof value.rawStage !== 'number') errors.push(`${path}.rawStage must be a number.`);
  if (typeof value.displayStage !== 'number') errors.push(`${path}.displayStage must be a number.`);
  if (typeof value.label !== 'string') errors.push(`${path}.label must be a string.`);
  if (value.isAttentionStage !== undefined && typeof value.isAttentionStage !== 'boolean') {
    errors.push(`${path}.isAttentionStage must be a boolean if present.`);
  }
  if (value.slaTargetDays !== null && typeof value.slaTargetDays !== 'number') {
    errors.push(`${path}.slaTargetDays must be a number or null.`);
  }
  if (!isPlainObject(value.checklist) || !Array.isArray(value.checklist.items)) {
    errors.push(`${path}.checklist.items must be an array.`);
    return null;
  }

  const items = value.checklist.items.map((item, i) =>
    validateChecklistItemPayload(item, `${path}.checklist.items[${i}]`, errors),
  );

  if (
    typeof value.rawStage !== 'number' ||
    typeof value.displayStage !== 'number' ||
    typeof value.label !== 'string' ||
    (value.slaTargetDays !== null && typeof value.slaTargetDays !== 'number') ||
    items.some((item) => item === null)
  ) {
    return null;
  }

  return {
    rawStage: value.rawStage,
    displayStage: value.displayStage,
    label: value.label,
    ...(typeof value.isAttentionStage === 'boolean' ? { isAttentionStage: value.isAttentionStage } : {}),
    slaTargetDays: value.slaTargetDays as number | null,
    checklist: { items: items as ChecklistItemTemplate[] },
    ...(typeof value.stageKey === 'string' && value.stageKey.trim() !== '' ? { stageKey: value.stageKey } : {}),
  };
}

export function validateWorkflowStagesPayload(body: unknown): { stages: StageTemplate[] | null; errors: string[] } {
  const errors: string[] = [];

  if (!isPlainObject(body) || !Array.isArray(body.stages)) {
    return { stages: null, errors: ['body.stages must be an array.'] };
  }

  const stages = body.stages.map((stage, i) => validateStagePayload(stage, `stages[${i}]`, errors));

  if (errors.length > 0 || stages.some((stage) => stage === null)) {
    return { stages: null, errors };
  }
  return { stages: stages as StageTemplate[], errors: [] };
}

/**
 * Phase 19 (Configurable Intake Form Builder). Shape/type DTO validation
 * for an admin's edited `intake` structure — the untrusted-JSON-body
 * counterpart to validateWorkflowStagesPayload above, same reasoning: an
 * HTTP body has no compile-time protection. Every Phase 19 property on
 * IntakeFieldTemplate is optional (see that type's own comment), so this
 * only rejects a property that's *present with the wrong type* — an
 * absent one is fine and left undefined, exactly matching what a
 * pre-Phase-19 record already looks like. Business-rule validation
 * (unique keys, non-empty labels, select-needs-options) is a separate,
 * deliberately later step — domain/workflow/editing.ts's
 * validateIntakeFields, run by the Route Handler only after this passes.
 */
function isStringArrayIfPresent(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((v) => typeof v === 'string'));
}

function validateIntakeFieldPayload(value: unknown, path: string, errors: string[]): IntakeFieldTemplate | null {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }

  // Phase 19A (Secure Payment Architecture): reject outright — not
  // silently strip — if a forged or mistaken workflow edit tries to attach
  // a literal card-data property directly to a field definition. Checked
  // first, before any other validation, so this can never be masked by an
  // otherwise-valid field.
  const forbidden = findForbiddenPaymentFields(value);
  if (forbidden.length > 0) {
    errors.push(`${path} must not contain payment card data (found: ${forbidden.join(', ')}).`);
    return null;
  }

  if (typeof value.key !== 'string') errors.push(`${path}.key must be a string.`);
  if (typeof value.label !== 'string') errors.push(`${path}.label must be a string.`);
  if (value.placeholder !== undefined && typeof value.placeholder !== 'string') {
    errors.push(`${path}.placeholder must be a string if present.`);
  }
  if (value.password !== undefined && typeof value.password !== 'boolean') {
    errors.push(`${path}.password must be a boolean if present.`);
  }
  if (value.checklistItemIndex !== undefined && typeof value.checklistItemIndex !== 'number') {
    errors.push(`${path}.checklistItemIndex must be a number if present.`);
  }
  if (value.mapsToCaseField !== undefined && typeof value.mapsToCaseField !== 'string') {
    errors.push(`${path}.mapsToCaseField must be a string if present.`);
  }
  if (value.fieldType !== undefined && typeof value.fieldType !== 'string') {
    errors.push(`${path}.fieldType must be a string if present.`);
  }
  if (value.required !== undefined && typeof value.required !== 'boolean') {
    errors.push(`${path}.required must be a boolean if present.`);
  }
  if (value.defaultValue !== undefined && typeof value.defaultValue !== 'string') {
    errors.push(`${path}.defaultValue must be a string if present.`);
  }
  if (value.displayOrder !== undefined && typeof value.displayOrder !== 'number') {
    errors.push(`${path}.displayOrder must be a number if present.`);
  }
  if (value.uppercase !== undefined && typeof value.uppercase !== 'boolean') {
    errors.push(`${path}.uppercase must be a boolean if present.`);
  }
  if (value.masked !== undefined && typeof value.masked !== 'boolean') {
    errors.push(`${path}.masked must be a boolean if present.`);
  }
  if (value.multiline !== undefined && typeof value.multiline !== 'boolean') {
    errors.push(`${path}.multiline must be a boolean if present.`);
  }
  if (value.validationType !== undefined && typeof value.validationType !== 'string') {
    errors.push(`${path}.validationType must be a string if present.`);
  }
  if (!isStringArrayIfPresent(value.options)) {
    errors.push(`${path}.options must be an array of strings if present.`);
  }
  if (value.paymentPurpose !== undefined && typeof value.paymentPurpose !== 'string') {
    errors.push(`${path}.paymentPurpose must be a string if present.`);
  }
  if (value.paymentAmount !== undefined && typeof value.paymentAmount !== 'string') {
    errors.push(`${path}.paymentAmount must be a string if present.`);
  }
  if (value.paymentDescription !== undefined && typeof value.paymentDescription !== 'string') {
    errors.push(`${path}.paymentDescription must be a string if present.`);
  }

  if (typeof value.key !== 'string' || typeof value.label !== 'string') {
    return null;
  }
  return value as unknown as IntakeFieldTemplate;
}

function validateIntakeSectionPayload(value: unknown, path: string, errors: string[]): IntakeSectionTemplate | null {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  if (typeof value.key !== 'string') errors.push(`${path}.key must be a string.`);
  if (typeof value.label !== 'string') errors.push(`${path}.label must be a string.`);
  if (!Array.isArray(value.fields)) {
    errors.push(`${path}.fields must be an array.`);
    return null;
  }

  const fields = value.fields.map((field, i) => validateIntakeFieldPayload(field, `${path}.fields[${i}]`, errors));

  if (typeof value.key !== 'string' || typeof value.label !== 'string' || fields.some((f) => f === null)) {
    return null;
  }
  return { key: value.key, label: value.label, fields: fields as IntakeFieldTemplate[] };
}

export function validateIntakeTemplatePayload(body: unknown): { intake: IntakeTemplate | null; errors: string[] } {
  const errors: string[] = [];

  if (!isPlainObject(body) || !isPlainObject(body.intake) || !Array.isArray(body.intake.sections)) {
    return { intake: null, errors: ['body.intake.sections must be an array.'] };
  }

  const sections = body.intake.sections.map((section, i) =>
    validateIntakeSectionPayload(section, `intake.sections[${i}]`, errors),
  );

  if (errors.length > 0 || sections.some((section) => section === null)) {
    return { intake: null, errors };
  }
  return { intake: { sections: sections as IntakeSectionTemplate[] }, errors: [] };
}

/**
 * Phase 18 (Workflow Management). Builds a `workflowTemplateVersions` Wix
 * item's data for insertion — this collection is append-only (see
 * docs/WIX_DATA_SCHEMA.md's Collection 4 "Immutability caveat": Wix Data
 * has no native insert-only enforcement, so the application layer must
 * only ever insert, never update, and this function's only caller
 * (app/api/workflow-templates/[templateId]/versions/route.ts) does exactly
 * that).
 */
export function buildWixWorkflowTemplateVersionData(params: {
  beaconTemplateId: string;
  version: number;
  caseTypes: string[];
  stages: StageTemplate[];
  intake: IntakeTemplate;
  createdAt: string;
  serviceTypeCodes?: string[];
  composition?: WorkflowComposition;
  /** Written only when given, so a version saved for an organization
      without approval keeps exactly its previous row shape. */
  status?: WorkflowTemplateVersion['status'];
  /** Workflow template editor (2026-10) — each written only when given. */
  createdBy?: string | null;
  createdByName?: string | null;
  /** Service-specific completion (2026-10) — each written only when given. */
  completionPolicy?: WorkflowCompletionPolicy;
  derivedFrom?: WorkflowVersionSource | null;
}): WixWorkflowTemplateVersionItem {
  return {
    beaconTemplateId: params.beaconTemplateId,
    version: params.version,
    caseTypes: params.caseTypes,
    stages: params.stages,
    intake: params.intake,
    createdAt: params.createdAt,
    // Written only when present, so a Manors version row is unchanged.
    ...(params.serviceTypeCodes ? { serviceTypeCodes: params.serviceTypeCodes } : {}),
    ...(params.composition ? { composition: params.composition } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.createdBy ? { createdBy: params.createdBy } : {}),
    ...(params.createdByName ? { createdByName: params.createdByName } : {}),
    ...(params.completionPolicy ? { completionPolicy: params.completionPolicy } : {}),
    ...(params.derivedFrom ? { derivedFrom: params.derivedFrom } : {}),
  };
}

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Builds a
 * `workflowTemplates` (template-identity) row — no prior phase needed
 * this, since every existing WorkflowTemplate was created via mock
 * fixture/direct Wix seeding, never a Route Handler. Used by
 * `services/organizationProvisioningService.ts`'s `provisionWorkflow`,
 * the first code path that actually creates a brand-new organization-
 * owned template rather than only ever adding a version to one that
 * already exists.
 */
export function buildWixWorkflowTemplateData(template: {
  id: string;
  organizationId: string;
  name: string;
  isEnabled: boolean;
  caseTypes: string[];
  serviceTypeCodes?: string[];
  description?: string | null;
}): WixWorkflowTemplateItem {
  return {
    beaconTemplateId: template.id,
    organizationId: template.organizationId,
    name: template.name,
    isEnabled: template.isEnabled,
    caseTypes: template.caseTypes,
    ...(template.serviceTypeCodes ? { serviceTypeCodes: template.serviceTypeCodes } : {}),
    ...(template.description !== undefined ? { description: template.description } : {}),
  };
}

/**
 * Service-specific workflows (2026-10). The approval write for one
 * `workflowTemplateVersions` row: the row's complete existing data with
 * ONLY status/approvedBy/approvedAt changed (updateWixDataItem is a full
 * replace). Stages, intake, caseTypes and version number are carried over
 * untouched — approval is metadata about a version, never an edit of its
 * content, so the collection's "content is append-only" rule holds.
 */
export function buildApprovedWixWorkflowTemplateVersionData(
  existing: WixWorkflowTemplateVersionItem,
  approval: { approvedBy: string; approvedAt: string; approvedByName?: string | null },
): WixWorkflowTemplateVersionItem {
  return { ...existing, ...buildWixWorkflowTemplateVersionApprovalFields(approval) };
}

/**
 * Workflow template editor (2026-10). Exactly the fields an approval sets
 * on a `workflowTemplateVersions` row — what the approve route PATCHES
 * (conditionally, on `status $eq 'draft'`) instead of replacing the whole
 * row it read earlier. buildApprovedWixWorkflowTemplateVersionData is the
 * same change expressed as the full resulting row.
 */
export function buildWixWorkflowTemplateVersionApprovalFields(approval: {
  approvedBy: string;
  approvedAt: string;
  approvedByName?: string | null;
}): Record<string, unknown> {
  return {
    status: 'approved',
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    ...(approval.approvedByName ? { approvedByName: approval.approvedByName } : {}),
  };
}
