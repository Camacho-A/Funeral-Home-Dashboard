import { describe, expect, it } from 'vitest';
import { isCaseDocumentDownloadable, isCaseDocumentHistorical, isCaseDocumentEligibleForBulkAction ,
  isFailedDocumentResolvedByLaterSuccess,
  isUnfinishedDocument,
  caseDocumentStatusLabel,
  CASE_DOCUMENT_STATUS_LABEL,
  remakeActionFor,
  isUnfinishedDocumentHistorical,
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

/**
 * Unfinished generations (2026-11). B2026-047's Statement v2 and Receipt
 * v1 were cut off mid-build and stayed `pending` — shown as "Draft" with
 * no file behind them.
 */
describe('unfinished documents', () => {
  const created = '2026-11-10T19:02:16.000Z';
  const at = (minutes: number) => Date.parse(created) + minutes * 60_000;
  const pending = { status: 'pending' as const, documentTypeKey: 'statement.account', createdAt: created };

  it('a pending document is "Generating…", never "Draft"', () => {
    expect(caseDocumentStatusLabel(pending, at(1))).toBe('Generating…');
    expect(Object.values(CASE_DOCUMENT_STATUS_LABEL)).not.toContain('Draft');
  });

  it("is \"Didn't finish\" once it has been pending for 10 minutes", () => {
    expect(isUnfinishedDocument(pending, at(9))).toBe(false);
    expect(isUnfinishedDocument(pending, at(10))).toBe(true);
    expect(caseDocumentStatusLabel(pending, at(10))).toBe("Didn't finish");
  });

  it('only ever applies to pending documents with a readable date', () => {
    expect(isUnfinishedDocument({ ...pending, status: 'active' }, at(60))).toBe(false);
    expect(isUnfinishedDocument({ ...pending, createdAt: undefined }, at(60))).toBe(false);
    expect(isUnfinishedDocument({ ...pending, createdAt: 'not a date' }, at(60))).toBe(false);
    expect(caseDocumentStatusLabel({ status: 'active' }, at(60))).toBe('Generated');
  });

  it('moves to History once that document has been made successfully', () => {
    const active = { status: 'active' as const, documentTypeKey: 'statement.account' };
    expect(isFailedDocumentResolvedByLaterSuccess(pending, [pending, active], at(10))).toBe(true);
    // Still being made: stays where it is.
    expect(isFailedDocumentResolvedByLaterSuccess(pending, [pending, active], at(1))).toBe(false);
    // Nothing succeeded yet: stays, so staff can see it needs doing again.
    expect(isFailedDocumentResolvedByLaterSuccess(pending, [pending], at(10))).toBe(false);
  });
});

describe('remakeActionFor', () => {
  const now = Date.parse('2026-11-10T20:00:00.000Z');
  const old = '2026-11-10T19:00:00.000Z';
  const doc = (documentTypeKey: string | null, status: 'pending' | 'failed' | 'active' = 'pending', origin = 'generated') => ({ documentTypeKey, status, origin, createdAt: old });

  it('maps each automatically made document to its own action', () => {
    expect(remakeActionFor(doc('financial.statement_goods_services'), now)).toBe('statement');
    expect(remakeActionFor(doc('statement.account'), now)).toBe('receipt');
    expect(remakeActionFor(doc('letter.envelope', 'failed'), now)).toBe('envelope');
    expect(remakeActionFor(doc('cremation_form.certificate_of_cremation'), now)).toBe('certificate_of_cremation');
    expect(remakeActionFor(doc('cremation_form.cremation_label'), now)).toBe('cremation_label');
  });

  it('only for a generated file that failed or did not finish, of a known type', () => {
    expect(remakeActionFor(doc('statement.account', 'active'), now)).toBeNull();
    expect(remakeActionFor({ ...doc('statement.account'), createdAt: '2026-11-10T19:58:00.000Z' }, now)).toBeNull();
    expect(remakeActionFor(doc('statement.account', 'failed', 'uploaded'), now)).toBeNull();
    expect(remakeActionFor(doc('authorization.cremation'), now)).toBeNull();
    expect(remakeActionFor(doc(null), now)).toBeNull();
  });

  it('an unfinished document is historical; one still being made is not', () => {
    expect(isUnfinishedDocumentHistorical({ status: 'pending', createdAt: old }, now)).toBe(true);
    expect(isUnfinishedDocumentHistorical({ status: 'pending', createdAt: '2026-11-10T19:58:00.000Z' }, now)).toBe(false);
  });
});
