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
