/**
 * Organization-aware external-form registry (2026-10, multi-tenant
 * hardening).
 *
 * WHY THIS EXISTS. Every piece of form-specific behaviour — which qid
 * holds which Case field, which forms get the Arrangement NOK derivation,
 * which PDF document type a submission is filed under, which prefill
 * block a link gets, which notification announces an arrival — used to be
 * an `if (externalFormId === '<Manors form id>')` comparison scattered
 * across the webhook, prefill, extraction and PDF code. That made Manors'
 * form ids part of every organization's code path, and gave a second
 * organization no way to describe its own forms without forking those
 * files.
 *
 * Behaviour now hangs off two small, pure tables:
 *
 *  1. LAYOUTS (`EXTERNAL_FORM_LAYOUTS`), keyed by `mappingKey`. A layout
 *     describes a form's SHAPE — its qid field map, its role, its PDF
 *     document type, which extraction/prefill rules apply. A layout
 *     carries no form id and no organization.
 *
 *  2. BINDINGS (`EXTERNAL_FORM_BINDINGS`), keyed by
 *     (organizationId, provider, externalFormId). A binding says "this
 *     organization's form N uses layout K". Bindings exist only for forms
 *     whose stored config rows predate `ExternalFormConfig.mappingKey`
 *     (i.e. Manors' three live forms), so those rows keep working with no
 *     data migration.
 *
 * Resolution (`resolveFormLayout`):
 *   - config.mappingKey set → that layout (unknown key → no layout; the
 *     config validator also reports it, and webhook resolution refuses an
 *     invalid config outright).
 *   - otherwise → the binding for (config.organizationId, provider,
 *     externalFormId), if one exists — a binding NEVER applies to a
 *     different organization, even for the same form id.
 *   - otherwise → null: GENERIC handling. No fields are mapped (the
 *     submission is stored for staff review), the PDF is filed under a
 *     generic name, no form-specific notification or prefill block runs.
 *     This is how a new organization (e.g. Gus Camacho Jr.) behaves until
 *     its own forms are registered.
 *
 * REGISTERING A NEW ORGANIZATION'S FORMS. Gus Camacho Jr. (and every
 * future organization) must use ITS OWN Jotform forms — never one of
 * Manors' form ids. Two config rows for the same (provider, externalFormId)
 * in different organizations are rejected by
 * services/externalFormConfigService.ts#validateExternalFormConfigs and the
 * webhook refuses to route such a form at all. To give a new form
 * structured mapping:
 *   - if the form is a Jotform CLONE of an existing layout (identical
 *     qids), set that org's config row `mappingKey` to the layout's key —
 *     no code change;
 *   - otherwise add a new layout below (verified qids only — never
 *     guessed) and set the config row's `mappingKey` to it.
 * Do not add bindings for new organizations; bindings are a legacy
 * bridge for rows without `mappingKey`.
 */
import type { ExternalFormConfig } from '@/types/externalFormConfig';
import {
  ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
  FIELD_MAP_ARRANGEMENT_FORMS,
  FIELD_MAP_FIRST_CALL_SHEET,
  FIELD_MAP_VITAL_STATISTICS,
  FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
  VITAL_STATISTICS_EXTERNAL_FORM_ID,
  type FieldMapEntry,
} from './fieldMapping';

/** What a form IS, for the purposes of form-specific behaviour. */
export type ExternalFormRole = 'arrangement' | 'vital_statistics' | 'first_call';

export type ExternalFormLayout = {
  mappingKey: string;
  provider: string;
  role: ExternalFormRole;
  /** Human description of the layout (never shown to families). */
  description: string;
  fieldMap: readonly FieldMapEntry[];
  /** `arrangement_nok_derivation` runs the qid-276-gated NOK derivation
      (arrangementNokDerivation.ts); `standard` is a plain field map. */
  extraction: 'standard' | 'arrangement_nok_derivation';
  /** Which hard-coded, verified prefill block buildJotformPrefillUrl may
      emit for this layout; `none` emits only the link token. */
  prefill: 'vital_statistics' | 'arrangement' | 'none';
  /** Staff-audience-only case-number reference fields, by Jotform name. */
  caseNumberPrefillFields: readonly { qid: string; jotformName: string }[];
  /** Document type + file name the original PDF is filed under. */
  pdfDocument: { documentTypeKey: string; displayFileName: string } | null;
};

export type ExternalFormBinding = {
  organizationId: string;
  provider: string;
  externalFormId: string;
  mappingKey: string;
};

// ---------------------------------------------------------------------------
// Manors (organization `managed-cremations`) — the only registered
// organization today. Everything Manors-specific lives in this block.
// ---------------------------------------------------------------------------

export const MANORS_ORGANIZATION_ID = 'managed-cremations';

export const MANORS_VITAL_STATISTICS_MAPPING_KEY = 'manors.jotform.vital-statistics';
export const MANORS_ARRANGEMENT_FORMS_MAPPING_KEY = 'manors.jotform.arrangement-forms';
export const MANORS_FIRST_CALL_SHEET_MAPPING_KEY = 'manors.jotform.first-call-sheet';

const MANORS_LAYOUTS: readonly ExternalFormLayout[] = [
  {
    mappingKey: MANORS_VITAL_STATISTICS_MAPPING_KEY,
    provider: 'jotform',
    role: 'vital_statistics',
    description: 'Manors Vital Statistics Information Sheet',
    fieldMap: FIELD_MAP_VITAL_STATISTICS,
    extraction: 'standard',
    prefill: 'vital_statistics',
    caseNumberPrefillFields: [],
    pdfDocument: { documentTypeKey: 'external_form.vital_statistics', displayFileName: 'Vital Statistics Information Sheet.pdf' },
  },
  {
    mappingKey: MANORS_ARRANGEMENT_FORMS_MAPPING_KEY,
    provider: 'jotform',
    role: 'arrangement',
    description: 'Manors Cremation Arrangement Forms',
    fieldMap: FIELD_MAP_ARRANGEMENT_FORMS,
    extraction: 'arrangement_nok_derivation',
    prefill: 'arrangement',
    // Arrangement Forms carries the case number in two separate fields.
    caseNumberPrefillFields: [
      { qid: '1', jotformName: 'caseNo' },
      { qid: '198', jotformName: 'caseNo198' },
    ],
    pdfDocument: { documentTypeKey: 'external_form.arrangement_forms', displayFileName: 'Arrangement Forms.pdf' },
  },
  {
    mappingKey: MANORS_FIRST_CALL_SHEET_MAPPING_KEY,
    provider: 'jotform',
    role: 'first_call',
    description: 'Manors First Call Sheet',
    fieldMap: FIELD_MAP_FIRST_CALL_SHEET,
    extraction: 'standard',
    prefill: 'none',
    caseNumberPrefillFields: [],
    // No dedicated document type was ever registered for this form; its
    // PDF has always been filed under the generic `{formId}.pdf` name.
    pdfDocument: null,
  },
];

const MANORS_BINDINGS: readonly ExternalFormBinding[] = [
  {
    organizationId: MANORS_ORGANIZATION_ID,
    provider: 'jotform',
    externalFormId: VITAL_STATISTICS_EXTERNAL_FORM_ID,
    mappingKey: MANORS_VITAL_STATISTICS_MAPPING_KEY,
  },
  {
    organizationId: MANORS_ORGANIZATION_ID,
    provider: 'jotform',
    externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
    mappingKey: MANORS_ARRANGEMENT_FORMS_MAPPING_KEY,
  },
  {
    organizationId: MANORS_ORGANIZATION_ID,
    provider: 'jotform',
    externalFormId: FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
    mappingKey: MANORS_FIRST_CALL_SHEET_MAPPING_KEY,
  },
];

// ---------------------------------------------------------------------------
// Gus Camacho Jr. (organization `gus-camacho-jr`) — NO forms registered.
// Its own Jotform forms do not exist yet; until they do, every Gus config
// row resolves to generic handling. Never bind a Manors form id here.
// ---------------------------------------------------------------------------

export const EXTERNAL_FORM_LAYOUTS: readonly ExternalFormLayout[] = [...MANORS_LAYOUTS];
export const EXTERNAL_FORM_BINDINGS: readonly ExternalFormBinding[] = [...MANORS_BINDINGS];

export function findLayoutByMappingKey(mappingKey: string | null | undefined): ExternalFormLayout | null {
  if (!mappingKey) return null;
  return EXTERNAL_FORM_LAYOUTS.find((layout) => layout.mappingKey === mappingKey) ?? null;
}

/** The legacy binding for exactly this organization's form — never one
    registered for a different organization with the same form id. */
export function findBinding(organizationId: string, provider: string, externalFormId: string): ExternalFormBinding | null {
  return (
    EXTERNAL_FORM_BINDINGS.find(
      (b) => b.organizationId === organizationId && b.provider === provider && b.externalFormId === externalFormId,
    ) ?? null
  );
}

export type FormLayoutSubject = Pick<ExternalFormConfig, 'organizationId' | 'provider' | 'externalFormId'> & {
  mappingKey?: string | null;
};

/** See the module doc comment for the resolution order. Null = generic. */
export function resolveFormLayout(subject: FormLayoutSubject): ExternalFormLayout | null {
  if (subject.mappingKey) {
    const layout = findLayoutByMappingKey(subject.mappingKey);
    return layout && layout.provider === subject.provider ? layout : null;
  }
  const binding = findBinding(subject.organizationId, subject.provider, subject.externalFormId);
  return binding ? findLayoutByMappingKey(binding.mappingKey) : null;
}

export function resolveFormRole(subject: FormLayoutSubject): ExternalFormRole | null {
  return resolveFormLayout(subject)?.role ?? null;
}

/** Org-aware field map for one config/submission. Empty = generic. */
export function fieldMapForConfig(subject: FormLayoutSubject): FieldMapEntry[] {
  return [...(resolveFormLayout(subject)?.fieldMap ?? [])];
}

/**
 * LEGACY, organization-blind lookup by form id, retained for callers and
 * tests that predate the registry. Searches registered bindings only, so
 * it can never return a mapping for an unregistered form. Production
 * call sites use the config-aware `fieldMapForConfig`/`resolveFormLayout`
 * instead, which additionally require the binding's organization to match.
 *
 * @deprecated use `fieldMapForConfig`.
 */
export function fieldMapForForm(provider: string, externalFormId: string): FieldMapEntry[] {
  const binding = EXTERNAL_FORM_BINDINGS.find((b) => b.provider === provider && b.externalFormId === externalFormId);
  if (!binding) return [];
  return [...(findLayoutByMappingKey(binding.mappingKey)?.fieldMap ?? [])];
}

/** Legacy, organization-blind counterpart of `resolveFormLayout`. */
export function legacyLayoutForForm(provider: string, externalFormId: string): ExternalFormLayout | null {
  const binding = EXTERNAL_FORM_BINDINGS.find((b) => b.provider === provider && b.externalFormId === externalFormId);
  return binding ? findLayoutByMappingKey(binding.mappingKey) : null;
}
