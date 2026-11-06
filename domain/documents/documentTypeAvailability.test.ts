import { describe, expect, it } from 'vitest';
import { documentTypesFor, isDocumentTypeAvailable, uploadableDocumentTypesFor } from './documentTypeAvailability';
import { DOCUMENT_TYPES, UPLOADABLE_DOCUMENT_TYPES } from './documentTypeRegistry';
import { GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';

const MANATEE = DOCUMENT_TYPES.VITAL_RECORDS_MANATEE_DEATH_CERTIFICATE_APPLICATION.key;

describe('document types by organization (2026-11)', () => {
  it('the Manatee County application is Manors-only — in the upload list, the template list and the check', () => {
    expect(isDocumentTypeAvailable(MANORS_ORGANIZATION_ID, MANATEE)).toBe(true);
    expect(isDocumentTypeAvailable(GUS_CAMACHO_ORGANIZATION_ID, MANATEE)).toBe(false);
    expect(isDocumentTypeAvailable(null, MANATEE)).toBe(false);
    expect(uploadableDocumentTypesFor(MANORS_ORGANIZATION_ID).map((t) => t.key)).toContain(MANATEE);
    expect(uploadableDocumentTypesFor(GUS_CAMACHO_ORGANIZATION_ID).map((t) => t.key)).not.toContain(MANATEE);
    expect(documentTypesFor(GUS_CAMACHO_ORGANIZATION_ID).map((t) => t.key)).not.toContain(MANATEE);
  });

  it('every other type stays available to both, in the same order', () => {
    const others = UPLOADABLE_DOCUMENT_TYPES.filter((t) => t.key !== MANATEE).map((t) => t.key);
    expect(uploadableDocumentTypesFor(GUS_CAMACHO_ORGANIZATION_ID).map((t) => t.key)).toEqual(others);
    expect(uploadableDocumentTypesFor(MANORS_ORGANIZATION_ID).map((t) => t.key)).toEqual(UPLOADABLE_DOCUMENT_TYPES.map((t) => t.key));
    expect(isDocumentTypeAvailable(GUS_CAMACHO_ORGANIZATION_ID, DOCUMENT_TYPES.CREMATION_FORM_STATE_PERMIT.key)).toBe(true);
  });
});
