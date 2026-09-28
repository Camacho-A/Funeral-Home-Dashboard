import { describe, expect, it } from 'vitest';
import {
  isPrintableMimeType,
  buildBulkDownloadZipFileName,
  buildBulkPrintPdfFileName,
  sanitizeZipEntryFileName,
  dedupeFileNames,
} from './bulkDocumentActions';

describe('isPrintableMimeType', () => {
  it('accepts PDF, JPEG, and PNG', () => {
    expect(isPrintableMimeType('application/pdf')).toBe(true);
    expect(isPrintableMimeType('image/jpeg')).toBe(true);
    expect(isPrintableMimeType('image/png')).toBe(true);
  });

  it('rejects DOCX and any other type', () => {
    expect(isPrintableMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
    expect(isPrintableMimeType('text/plain')).toBe(false);
    expect(isPrintableMimeType('')).toBe(false);
  });
});

describe('buildBulkDownloadZipFileName / buildBulkPrintPdfFileName', () => {
  it('uses the exact case number', () => {
    expect(buildBulkDownloadZipFileName('B2026-034')).toBe('B2026-034-documents.zip');
    expect(buildBulkPrintPdfFileName('B2026-034')).toBe('B2026-034-documents.pdf');
  });

  it('sanitizes an unsafe/unexpected case number rather than trusting it verbatim', () => {
    expect(buildBulkDownloadZipFileName('../../etc/passwd')).not.toContain('/');
    expect(buildBulkDownloadZipFileName('../../etc/passwd')).not.toContain('..');
  });

  it('falls back to a safe default for an empty case number', () => {
    expect(buildBulkDownloadZipFileName('')).toBe('case-documents.zip');
  });
});

describe('sanitizeZipEntryFileName', () => {
  it('preserves an ordinary filename unchanged', () => {
    expect(sanitizeZipEntryFileName('Death Certificate.pdf')).toBe('Death Certificate.pdf');
    expect(sanitizeZipEntryFileName('Statement.pdf')).toBe('Statement.pdf');
  });

  it('strips path traversal segments down to the leaf name only', () => {
    expect(sanitizeZipEntryFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeZipEntryFileName('../../../evil.pdf')).toBe('evil.pdf');
    expect(sanitizeZipEntryFileName('a/b/c/Statement.pdf')).toBe('Statement.pdf');
  });

  it('strips backslash-based (Windows-style) path segments too', () => {
    expect(sanitizeZipEntryFileName('..\\..\\Windows\\evil.pdf')).toBe('evil.pdf');
  });

  it('strips control characters while preserving ordinary spaces/hyphens/parentheses', () => {
    expect(sanitizeZipEntryFileName('Statement.pdf')).toBe('Statement.pdf');
    expect(sanitizeZipEntryFileName('Death Certificate (copy).pdf')).toBe('Death Certificate (copy).pdf');
  });

  it('never produces a leading-dot hidden-file name', () => {
    expect(sanitizeZipEntryFileName('.hidden')).toBe('hidden');
  });

  it('never returns an empty string', () => {
    expect(sanitizeZipEntryFileName('')).toBe('document');
    expect(sanitizeZipEntryFileName('../')).toBe('document');
  });
});

describe('dedupeFileNames', () => {
  it('leaves unique filenames unchanged', () => {
    expect(dedupeFileNames(['Statement.pdf', 'Death Certificate.pdf'])).toEqual(['Statement.pdf', 'Death Certificate.pdf']);
  });

  it('disambiguates duplicate filenames deterministically, preserving the extension', () => {
    expect(dedupeFileNames(['Statement.pdf', 'Statement.pdf', 'Statement.pdf'])).toEqual([
      'Statement.pdf',
      'Statement (2).pdf',
      'Statement (3).pdf',
    ]);
  });

  it('handles duplicates with no extension', () => {
    expect(dedupeFileNames(['README', 'README'])).toEqual(['README', 'README (2)']);
  });

  it('does not treat a leading dot as an extension separator', () => {
    expect(dedupeFileNames(['.gitignore', '.gitignore'])).toEqual(['.gitignore', '.gitignore (2)']);
  });
});
