import { describe, expect, it } from 'vitest';
import { isCaseDocumentDownloadable, isCaseDocumentHistorical, isCaseDocumentEligibleForBulkAction } from './caseDocumentDisplay';
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

/**
 * Task #12 follow-up (2026-09, Documents/History separation) — which
 * statuses browse under the Case Detail Documents tab's "History"
 * sub-tab vs. its primary "Documents" sub-tab.
 */
describe('isCaseDocumentHistorical', () => {
  it('superseded and archived are historical', () => {
    expect(isCaseDocumentHistorical('superseded')).toBe(true);
    expect(isCaseDocumentHistorical('archived')).toBe(true);
  });

  it('pending, active, and failed are NOT historical — a failed record with no usable file is never presented as a historical PDF', () => {
    expect(isCaseDocumentHistorical('pending')).toBe(false);
    expect(isCaseDocumentHistorical('active')).toBe(false);
    expect(isCaseDocumentHistorical('failed')).toBe(false);
  });
});

/**
 * Task #12 follow-up. Print All/Download All's own eligibility rule —
 * narrower than isCaseDocumentDownloadable (excludes superseded), but
 * deliberately keeps archived alongside active (see this function's own
 * doc comment for why that precedent is preserved, not revisited).
 */
describe('isCaseDocumentEligibleForBulkAction', () => {
  it('active and archived are bulk-eligible', () => {
    expect(isCaseDocumentEligibleForBulkAction('active')).toBe(true);
    expect(isCaseDocumentEligibleForBulkAction('archived')).toBe(true);
  });

  it('superseded, pending, and failed are excluded from bulk actions', () => {
    expect(isCaseDocumentEligibleForBulkAction('superseded')).toBe(false);
    expect(isCaseDocumentEligibleForBulkAction('pending')).toBe(false);
    expect(isCaseDocumentEligibleForBulkAction('failed')).toBe(false);
  });
});
