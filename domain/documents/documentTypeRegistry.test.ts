import { describe, expect, it } from 'vitest';
import type { DocumentTemplateCategory } from '@/types/documentTemplate';
import { DOCUMENT_TYPES, getDocumentTypeDefinition, isValidDocumentTypeKey } from './documentTypeRegistry';

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
