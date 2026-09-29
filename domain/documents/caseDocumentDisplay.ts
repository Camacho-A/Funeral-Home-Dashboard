import type { CaseDocumentStatus } from '@/types/caseDocument';
import type { BadgeVariant } from '@/components/ui/Badge';

/**
 * Phase 25 (Document Generation & Template Management). Which
 * `CaseDocumentStatus` maps to which display label/Badge variant — a
 * domain decision, kept out of `components/case/CaseDocumentsTab.tsx` per
 * `Badge`'s own convention. Display labels match this phase's own
 * lifecycle naming (types/caseDocument.ts's own comment): pending ->
 * "Draft", active -> "Generated", superseded -> "Superseded",
 * archived -> "Archived", failed -> "Generation Failed".
 */
export const CASE_DOCUMENT_STATUS_LABEL: Record<CaseDocumentStatus, string> = {
  pending: 'Draft',
  active: 'Generated',
  superseded: 'Superseded',
  archived: 'Archived',
  failed: 'Generation Failed',
};

export function caseDocumentStatusVariant(status: CaseDocumentStatus): BadgeVariant {
  if (status === 'active') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'pending') return 'brand';
  return 'neutral'; // superseded, archived
}

/**
 * Task #3 (2026-09, bulk case document actions). The single definition of
 * "is this document currently a valid, staff-accessible document" —
 * previously duplicated inline as `CaseDocumentsTab.tsx`'s own
 * `canDownload` check and `services/documentService.ts#downloadFile`'s own
 * rejection condition. Both now call this instead, so individual
 * Download/Print and the new Print All/Download All bulk actions can never
 * silently drift out of sync on which statuses are eligible. `pending`
 * (still generating) and `failed` (generation/upload never completed) are
 * the only two statuses with no real storage object to retrieve —
 * `active`/`superseded`/`archived` all have one, matching the deliberate
 * Manors decision that an Archived document stays visible/downloadable
 * (item #12) — Archive only hides the *action* for Manors, never the
 * already-archived document's own retrievability.
 */
export function isCaseDocumentDownloadable(status: CaseDocumentStatus): boolean {
  return status === 'active' || status === 'superseded' || status === 'archived';
}

/**
 * Task #12 follow-up (2026-09, Documents/History separation). Which
 * statuses represent a document's *historical* record, shown under the
 * Case Detail Documents tab's "History" sub-tab rather than its primary
 * "Documents" sub-tab: a superseded regeneration, or a document staff
 * explicitly archived — the archive confirm dialog's own copy already
 * promises "hidden from the active document list"
 * (components/case/CaseDocumentsTab.tsx), a promise this is the first
 * place to actually honor. `pending` (still generating) and `failed` (no
 * usable file — see the B2026-034 cleanup precedent, where the six
 * failed rows had no storage key at all) are deliberately NOT historical:
 * a failed record is not a real retained document, and a pending one is
 * the newest in-progress attempt at the current version — both stay in
 * the primary Documents view, never presented as historical PDFs.
 */
export function isCaseDocumentHistorical(status: CaseDocumentStatus): boolean {
  return status === 'superseded' || status === 'archived';
}

/**
 * Task #12 final follow-up (2026-09, bulk actions scoped to the current
 * Documents view). Print All / Download All live in the Documents
 * sub-tab's own toolbar, so their eligibility must be drawn from exactly
 * the same set the Documents view itself renders — never reaching into
 * History. Superseded a prior version of this rule (2026-09, Documents/
 * History separation) that deliberately kept `archived` bulk-eligible,
 * preserving an earlier, separate document-archiving precedent
 * (handwritten item #12, Archive removal for Manors) that archiving only
 * hides the *archive action*, never a document's own retrievability.
 * That precedent still holds for *individual* Download/Print
 * (`isCaseDocumentDownloadable`, unchanged — an archived document's own
 * row in History still offers Download/Print) — it just no longer
 * extends to the *bulk* actions once archived moved out of the
 * Documents view entirely. Concretely: of the three current-view
 * statuses (`pending`/`active`/`failed`), only `active` ever has a real
 * stored file — `pending` is still generating and `failed` never
 * completed (both persist with an empty `storageKey`, see
 * `services/documentService.ts#completeDocumentGeneration`) — so
 * "current AND usable" reduces to exactly `status === 'active'`.
 *
 * The invariant this must never violate: `isCaseDocumentHistorical(s)`
 * true implies this returns false for the same `s` — enforced by
 * `isCaseDocumentEligibleForBulkAction` never testing a status
 * `isCaseDocumentHistorical` also claims (see this file's own test for
 * an explicit, exhaustive check over every `CaseDocumentStatus`).
 */
export function isCaseDocumentEligibleForBulkAction(status: CaseDocumentStatus): boolean {
  return status === 'active';
}
