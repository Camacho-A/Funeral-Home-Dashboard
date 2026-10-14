import { describe, expect, it } from 'vitest';
import { isCaseDocumentDownloadable, isCaseDocumentHistorical, isCaseDocumentEligibleForBulkAction ,
  isFailedDocumentResolvedByLaterSuccess,
} from './caseDocumentDisplay';
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

/**
 * A failed generation that a later attempt succeeded past (2026-10).
 * B2026-038's v1 failed and v2 succeeded; v1 had been sitting in the
 * active Documents list ever since as an unfixable "Generation Failed"
 * row with no file behind it.
 */
describe('isFailedDocumentResolvedByLaterSuccess', () => {
  const failed = { status: 'failed' as const, documentTypeKey: 'financial.statement_goods_services' };

  it('is resolved once a successful version of the same type exists', () => {
    const active = { status: 'active' as const, documentTypeKey: 'financial.statement_goods_services' };
    expect(isFailedDocumentResolvedByLaterSuccess(failed, [failed, active])).toBe(true);
  });

  it('stays in the primary list while the failure is the latest word', () => {
    // Staff need to see that generating did not work, so they can retry.
    expect(isFailedDocumentResolvedByLaterSuccess(failed, [failed])).toBe(false);
  });

  it('a second failure does not resolve the first', () => {
    const otherFailed = { status: 'failed' as const, documentTypeKey: 'financial.statement_goods_services' };
    expect(isFailedDocumentResolvedByLaterSuccess(failed, [failed, otherFailed])).toBe(false);
  });

  it('a pending attempt does not resolve it — nothing has succeeded yet', () => {
    const pending = { status: 'pending' as const, documentTypeKey: 'financial.statement_goods_services' };
    expect(isFailedDocumentResolvedByLaterSuccess(failed, [failed, pending])).toBe(false);
  });

  it('a superseded or archived version still counts as having succeeded', () => {
    // Both have a real storage object; the type demonstrably generated.
    for (const status of ['superseded', 'archived'] as const) {
      expect(
        isFailedDocumentResolvedByLaterSuccess(failed, [failed, { status, documentTypeKey: failed.documentTypeKey }]),
        status,
      ).toBe(true);
    }
  });

  it('a success of a DIFFERENT type does not resolve it', () => {
    const otherType = { status: 'active' as const, documentTypeKey: 'statement.account' };
    expect(isFailedDocumentResolvedByLaterSuccess(failed, [failed, otherType])).toBe(false);
  });

  it('never applies to a document that did not fail', () => {
    const active = { status: 'active' as const, documentTypeKey: 'financial.statement_goods_services' };
    expect(isFailedDocumentResolvedByLaterSuccess(active, [active, failed])).toBe(false);
  });
});
