import { describe, expect, it } from 'vitest';
import type { DocumentTemplateCategory } from '@/types/documentTemplate';
import { DOCUMENT_TYPES, getDocumentTypeDefinition, isValidDocumentTypeKey, SOLIS_BUILT_DOCUMENT_TYPE_KEYS, UPLOADABLE_DOCUMENT_TYPES } from './documentTypeRegistry';

const CATEGORIES: DocumentTemplateCategory[] = [
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

describe('DOCUMENT_TYPES', () => {
  it('every entry has a distinct key', () => {
    const keys = Object.values(DOCUMENT_TYPES).map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every entry\'s displayName is never derived from (or equal to) its own dot-notation key', () => {
    for (const entry of Object.values(DOCUMENT_TYPES)) {
      expect(entry.displayName).not.toBe(entry.key);
      expect(entry.displayName).not.toContain('.');
    }
  });

  it('every entry\'s category is one of the ten spec-named categories', () => {
    for (const entry of Object.values(DOCUMENT_TYPES)) {
      expect(CATEGORIES).toContain(entry.category);
    }
  });

  it('covers every one of the ten categories with at least one entry', () => {
    const usedCategories = new Set(Object.values(DOCUMENT_TYPES).map((entry) => entry.category));
    for (const category of CATEGORIES) {
      expect(usedCategories.has(category), `expected at least one document type in category "${category}"`).toBe(true);
    }
  });

  it('includes every example key named in the original spec', () => {
    const keys = Object.values(DOCUMENT_TYPES).map((entry) => entry.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'contract.funeral',
        'authorization.cremation',
        'authorization.embalming',
        'financial.invoice',
        'financial.receipt',
        'obituary',
        'internal.checklist',
      ]),
    );
  });
});

describe('isValidDocumentTypeKey / getDocumentTypeDefinition', () => {
  it('recognizes a real key', () => {
    expect(isValidDocumentTypeKey('contract.funeral')).toBe(true);
    expect(getDocumentTypeDefinition('contract.funeral')?.displayName).toBe('Funeral Contract');
  });

  it('rejects an unrecognized key', () => {
    expect(isValidDocumentTypeKey('not.a.real.key')).toBe(false);
    expect(getDocumentTypeDefinition('not.a.real.key')).toBeNull();
  });
});

describe('UPLOADABLE_DOCUMENT_TYPES (Documents → Upload File, 2026-10)', () => {
  it('is the canonical list — same keys and names, no duplicates — State Cremation Permit and Arrangement Forms first', () => {
    expect(UPLOADABLE_DOCUMENT_TYPES.slice(0, 2).map((t) => t.key)).toEqual(['cremation_form.state_permit', 'external_form.arrangement_forms']);
    for (const t of UPLOADABLE_DOCUMENT_TYPES) {
      expect(isValidDocumentTypeKey(t.key)).toBe(true);
      expect(Object.values(DOCUMENT_TYPES)).toContain(t);
    }
    expect(new Set(UPLOADABLE_DOCUMENT_TYPES.map((t) => t.key)).size).toBe(UPLOADABLE_DOCUMENT_TYPES.length);
    expect(new Set(UPLOADABLE_DOCUMENT_TYPES.map((t) => t.displayName)).size).toBe(UPLOADABLE_DOCUMENT_TYPES.length);
  });

  it('leaves out only what Send to Crematory builds itself', () => {
    expect([...SOLIS_BUILT_DOCUMENT_TYPE_KEYS].sort()).toEqual(['cremation_form.crematory_package', 'external_form.crematory_form']);
    expect(UPLOADABLE_DOCUMENT_TYPES).toHaveLength(Object.keys(DOCUMENT_TYPES).length - 2);
    expect(UPLOADABLE_DOCUMENT_TYPES.some((t) => SOLIS_BUILT_DOCUMENT_TYPE_KEYS.has(t.key))).toBe(false);
  });
});

