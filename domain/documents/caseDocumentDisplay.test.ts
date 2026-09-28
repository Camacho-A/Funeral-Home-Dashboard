import { describe, expect, it } from 'vitest';
import { isCaseDocumentDownloadable } from './caseDocumentDisplay';
import type { CaseDocumentStatus } from '@/types/caseDocument';

/**
 * Task #3 (2026-09) — the single eligibility rule shared by individual
 * Download/Print (services/documentService.ts#downloadFile,
 * components/case/CaseDocumentsTab.tsx's own canDownload) and the new
 * Print All/Download All bulk actions. No dedicated test file existed for
 * caseDocumentDisplay.ts before; added here alongside this new export.
 */
describe('isCaseDocumentDownloadable', () => {
  it('active, superseded, and archived documents are all downloadable — archived stays consistent with item #12 (Manors Archive disabled, existing archived docs remain accessible)', () => {
    const eligible: CaseDocumentStatus[] = ['active', 'superseded', 'archived'];
    for (const status of eligible) {
      expect(isCaseDocumentDownloadable(status)).toBe(true);
    }
  });

  it('pending (still generating) and failed (never completed) have no real storage object — never downloadable', () => {
    expect(isCaseDocumentDownloadable('pending')).toBe(false);
    expect(isCaseDocumentDownloadable('failed')).toBe(false);
  });
});
