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
 * Task #12 final follow-up (2026-09, bulk actions scoped to the current
 * Documents view). Print All/Download All's own eligibility rule — only
 * `active` (the sole current-view status with a real stored file).
 * Narrower than isCaseDocumentDownloadable (also excludes superseded,
 * unchanged) AND narrower than an earlier version of this same function
 * that deliberately kept `archived` bulk-eligible — revised here because
 * archived documents now browse under History, and bulk actions must
 * never reach into History (see this function's own doc comment for the
 * full history of that revision).
 */
describe('isCaseDocumentEligibleForBulkAction', () => {
  it('only active is bulk-eligible', () => {
    expect(isCaseDocumentEligibleForBulkAction('active')).toBe(true);
  });

  it('superseded, archived, pending, and failed are all excluded from bulk actions', () => {
    expect(isCaseDocumentEligibleForBulkAction('superseded')).toBe(false);
    expect(isCaseDocumentEligibleForBulkAction('archived')).toBe(false);
    expect(isCaseDocumentEligibleForBulkAction('pending')).toBe(false);
    expect(isCaseDocumentEligibleForBulkAction('failed')).toBe(false);
  });
});

/**
 * Task #12 final follow-up. The governing invariant requested explicitly:
 * a status classified as historical must never simultaneously satisfy
 * bulk-action eligibility — checked exhaustively over every
 * CaseDocumentStatus, not just the statuses historical today, so a
 * future status addition can't silently violate it unnoticed.
 */
describe('isCaseDocumentHistorical / isCaseDocumentEligibleForBulkAction invariant', () => {
  it('no historical status ever satisfies bulk-action eligibility', () => {
    const ALL_STATUSES: CaseDocumentStatus[] = ['pending', 'active', 'superseded', 'archived', 'failed'];
    for (const status of ALL_STATUSES) {
      if (isCaseDocumentHistorical(status)) {
        expect(isCaseDocumentEligibleForBulkAction(status)).toBe(false);
      }
    }
  });

  it('the two predicates partition current-view statuses correctly: every non-historical status is either bulk-eligible or explicitly not-yet-usable (pending/failed)', () => {
    const NOT_YET_USABLE: CaseDocumentStatus[] = ['pending', 'failed'];
    const ALL_STATUSES: CaseDocumentStatus[] = ['pending', 'active', 'superseded', 'archived', 'failed'];
    for (const status of ALL_STATUSES) {
      if (!isCaseDocumentHistorical(status)) {
        const expectedEligible = !NOT_YET_USABLE.includes(status);
        expect(isCaseDocumentEligibleForBulkAction(status)).toBe(expectedEligible);
      }
    }
  });
});
