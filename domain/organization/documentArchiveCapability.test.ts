import { describe, expect, it } from 'vitest';
import {
  documentRemovalDescription,
  isDocumentArchivingAdministratorsOnly,
  isDocumentArchivingEnabled,
  MANORS_ORGANIZATION_ID,
  parseDocumentRemoval,
} from './documentArchiveCapability';

/**
 * Handwritten item #12 (2026-09, document Archive removal for Manors).
 */
describe('isDocumentArchivingEnabled', () => {
  it('1: Manors has it back (2026-10), as the administrators-only Remove', () => {
    expect(isDocumentArchivingEnabled(MANORS_ORGANIZATION_ID)).toBe(true);
    expect(isDocumentArchivingAdministratorsOnly(MANORS_ORGANIZATION_ID)).toBe(true);
    expect(isDocumentArchivingAdministratorsOnly('some-other-org')).toBe(false);
    expect(isDocumentArchivingAdministratorsOnly(null)).toBe(false);
  });

  it('8/9: another organization defaults to enabled (existing behavior preserved)', () => {
    expect(isDocumentArchivingEnabled('some-other-org')).toBe(true);
  });

  it('a null/undefined organizationId (not yet loaded) defaults to enabled — never default-off globally', () => {
    expect(isDocumentArchivingEnabled(null)).toBe(true);
    expect(isDocumentArchivingEnabled(undefined)).toBe(true);
  });
});

describe('parseDocumentRemoval (2026-10)', () => {
  it('needs a known reason; "Other" needs details', () => {
    expect(parseDocumentRemoval({})).toEqual({ error: 'Choose why the document is being removed.' });
    expect(parseDocumentRemoval({ reason: 'bored' })).toHaveProperty('error');
    expect(parseDocumentRemoval({ reason: 'other', note: '  ' })).toEqual({ error: 'Describe why the document is being removed.' });
    expect(parseDocumentRemoval({ reason: 'duplicate' })).toEqual({ reason: 'duplicate', note: null });
    expect(parseDocumentRemoval({ reason: 'wrong_document', note: ' belongs to B2026-040 ' })).toEqual({ reason: 'wrong_document', note: 'belongs to B2026-040' });
  });

  it('describes the removal for the case activity', () => {
    expect(documentRemovalDescription({ reason: 'duplicate', note: null })).toBe('Document removed — Duplicate');
    expect(documentRemovalDescription({ reason: 'other', note: 'scan unreadable' })).toBe('Document removed — Other: scan unreadable');
  });
});
