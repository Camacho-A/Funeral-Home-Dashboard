import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { ExternalFormConfig } from '@/types/externalFormConfig';
import {
  EXTERNAL_FORM_BINDINGS,
  MANORS_ARRANGEMENT_FORMS_MAPPING_KEY,
  MANORS_ORGANIZATION_ID,
  fieldMapForConfig,
  presentedExternalFormDocument,
  resolveFormLayout,
  resolveFormRole,
} from './formRegistry';
import {
  ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
  FIELD_MAP_ARRANGEMENT_FORMS,
  FIELD_MAP_FIRST_CALL_SHEET,
  FIELD_MAP_VITAL_STATISTICS,
  FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
  VITAL_STATISTICS_EXTERNAL_FORM_ID,
} from './fieldMapping';
import { extractMappedFieldsForForm } from './arrangementNokDerivation';
import { buildJotformPrefillUrl } from './prefillUrl';
import { getDocumentTypeDefinition } from '../documents/documentTypeRegistry';

const GUS = 'gus-camacho-jr';
const GUS_FORM_ID = '300000000000001';

function config(overrides: Partial<ExternalFormConfig>): ExternalFormConfig {
  return {
    id: 'cfg',
    organizationId: MANORS_ORGANIZATION_ID,
    provider: 'jotform',
    externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID,
    label: 'Form',
    audience: 'staff',
    purpose: 'case_update',
    fieldMap: '{}',
    linkTokenFieldName: 'solisLinkToken',
    linkTokenFieldQid: '1',
    webhookAuthFieldQid: '',
    isEnabled: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const PREFILL_VALUES = {
  caseNumber: 'M2026-001',
  decedentName: 'Jane Doe',
  dateOfBirth: '01/02/1940',
  dateOfDeath: '03/04/2026',
  nextOfKinName: 'John Doe',
  nextOfKinPhone: '555-0100',
  nextOfKinEmail: 'john@example.com',
  nextOfKinRelationship: 'son' as const,
};

describe('Manors behaviour is unchanged through the registry', () => {
  it.each([
    [VITAL_STATISTICS_EXTERNAL_FORM_ID, FIELD_MAP_VITAL_STATISTICS, 'vital_statistics'],
    [ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, FIELD_MAP_ARRANGEMENT_FORMS, 'arrangement'],
    [FIRST_CALL_SHEET_EXTERNAL_FORM_ID, FIELD_MAP_FIRST_CALL_SHEET, 'first_call'],
  ])('Manors form %s resolves to its own field map and role', (formId, fieldMap, role) => {
    const manors = config({ externalFormId: formId });
    expect(fieldMapForConfig(manors)).toEqual(fieldMap);
    expect(resolveFormRole(manors)).toBe(role);
  });

  it('Manors Arrangement still runs the NOK derivation', () => {
    const answers = { '276': { answer: 'Yes' }, '122': { answer: { first: 'Pat', last: 'Rivera' } } };
    expect(extractMappedFieldsForForm(config({}), answers).nextOfKinName).toBe('Pat Rivera');
  });
});

describe('organization-aware: a binding never applies to another organization', () => {
  it('a Gus config carrying a Manors form id gets NO Manors mapping (generic)', () => {
    const gusMisconfigured = config({ organizationId: GUS, externalFormId: ARRANGEMENT_FORMS_EXTERNAL_FORM_ID });
    expect(resolveFormLayout(gusMisconfigured)).toBeNull();
    const answers = { '87': { answer: { first: 'A', last: 'B' } }, '276': { answer: 'Yes' } };
    expect(extractMappedFieldsForForm(gusMisconfigured, answers)).toEqual({});
  });

  it('Gus config without a mapping → generic handling: nothing mapped, no role, only the link token prefilled', () => {
    const gus = config({ organizationId: GUS, externalFormId: GUS_FORM_ID, audience: 'staff' });
    expect(resolveFormLayout(gus)).toBeNull();
    expect(resolveFormRole(gus)).toBeNull();
    expect(extractMappedFieldsForForm(gus, { '3': { answer: { first: 'A', last: 'B' } } })).toEqual({});

    const url = new URL(buildJotformPrefillUrl(gus, PREFILL_VALUES, 'raw-token'));
    expect(url.pathname).toBe(`/${GUS_FORM_ID}`);
    expect([...url.searchParams.keys()]).toEqual(['solisLinkToken']);
  });

  it('a Gus config can explicitly opt into a registered layout via mappingKey (e.g. a cloned form)', () => {
    const gusClone = config({ organizationId: GUS, externalFormId: GUS_FORM_ID, mappingKey: MANORS_ARRANGEMENT_FORMS_MAPPING_KEY });
    expect(resolveFormRole(gusClone)).toBe('arrangement');
    expect(fieldMapForConfig(gusClone)).toEqual(FIELD_MAP_ARRANGEMENT_FORMS);
  });

  it('an unknown mappingKey resolves to no layout rather than guessing', () => {
    expect(resolveFormLayout(config({ mappingKey: 'nope' }))).toBeNull();
  });

  it('no binding is registered for any organization other than Manors', () => {
    expect(new Set(EXTERNAL_FORM_BINDINGS.map((b) => b.organizationId))).toEqual(new Set([MANORS_ORGANIZATION_ID]));
  });
});

describe('Manors form ids never appear in organization-generic code paths', () => {
  const MANORS_IDS = [VITAL_STATISTICS_EXTERNAL_FORM_ID, ARRANGEMENT_FORMS_EXTERNAL_FORM_ID, FIRST_CALL_SHEET_EXTERNAL_FORM_ID];
  const GENERIC_FILES = [
    'app/api/webhooks/jotform/route.ts',
    'domain/externalForms/prefillUrl.ts',
    'domain/externalForms/arrangementNokDerivation.ts',
    'domain/externalForms/extractMappedFields.ts',
    'services/externalFormPdfService.ts',
    'services/externalFormConfigService.ts',
    'services/externalFormIntakeService.ts',
  ];
  const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  for (const file of GENERIC_FILES) {
    it(`${file} carries no Manors form id or Manors form-id constant in code`, () => {
      const code = stripComments(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
      for (const id of MANORS_IDS) expect(code).not.toContain(id);
      expect(code).not.toMatch(/\b(ARRANGEMENT_FORMS|VITAL_STATISTICS|FIRST_CALL_SHEET)_EXTERNAL_FORM_ID\b/);
      expect(code).not.toContain('Manors First Call Sheet');
    });
  }
});

/**
 * First Call document name (2026-10). New First Call PDFs are filed as
 * "First Call.pdf" under a registered type; PDFs stored earlier as the bare
 * `{formId}.pdf` are presented under the same name without rewriting them.
 */
describe('First Call document naming', () => {
  const storedLegacy = {
    organizationId: MANORS_ORGANIZATION_ID,
    origin: 'uploaded',
    documentTypeKey: null as string | null,
    fileName: `${FIRST_CALL_SHEET_EXTERNAL_FORM_ID}.pdf`,
  };

  it('files a new First Call PDF as "First Call" under its own document type', () => {
    const pdf = resolveFormLayout(config({ externalFormId: FIRST_CALL_SHEET_EXTERNAL_FORM_ID }))!.pdfDocument!;
    expect(pdf.displayFileName).toBe('First Call.pdf');
    expect(getDocumentTypeDefinition(pdf.documentTypeKey)?.displayName).toBe('First Call');
  });

  it('presents a First Call PDF stored under its form id as "First Call"', () => {
    const presented = presentedExternalFormDocument(storedLegacy);
    expect(presented.fileName).toBe('First Call.pdf');
    expect(getDocumentTypeDefinition(presented.documentTypeKey!)?.displayName).toBe('First Call');
  });

  it('never mutates the stored row', () => {
    const copy = { ...storedLegacy };
    presentedExternalFormDocument(storedLegacy);
    expect(storedLegacy).toEqual(copy);
  });

  it('leaves another organization\'s identically-named document alone', () => {
    const gus = { ...storedLegacy, organizationId: GUS };
    expect(presentedExternalFormDocument(gus)).toBe(gus);
  });

  it('leaves typed, generated, and unrelated documents alone', () => {
    const typed = { ...storedLegacy, documentTypeKey: 'external_form.arrangement_forms' };
    const generated = { ...storedLegacy, origin: 'generated' };
    const unrelated = { ...storedLegacy, fileName: 'death-certificate.pdf' };
    const unboundId = { ...storedLegacy, fileName: '999999999999999.pdf' };
    for (const doc of [typed, generated, unrelated, unboundId]) expect(presentedExternalFormDocument(doc)).toBe(doc);
  });

  it('Arrangement and Vital Statistics names are unchanged', () => {
    expect(resolveFormLayout(config({}))!.pdfDocument!.displayFileName).toBe('Arrangement Forms.pdf');
    expect(resolveFormLayout(config({ externalFormId: VITAL_STATISTICS_EXTERNAL_FORM_ID }))!.pdfDocument!.displayFileName).toBe(
      'Vital Statistics Information Sheet.pdf',
    );
  });
});
