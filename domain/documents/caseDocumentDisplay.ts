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
