import type { Case } from '../../types/case';
import type { CaseFormLink } from '../../types/caseFormLink';
import type { MappedSolisField } from './fieldMapping';
import type { DuplicateCandidate } from './duplicateCandidates';

/**
 * Attaching a form to the case it belongs to (2026-10).
 *
 * THE GAP: at Manors the First Call Sheet usually creates the case, and
 * the Cremation Arrangement Forms for the same death are filled in
 * directly on Jotform afterwards — not through a SOLIS-generated link —
 * so the delivery carries no link token. The duplicate guard
 * (duplicateCandidates.ts) then correctly refused to create a SECOND
 * case, but it also stopped there: every such Arrangement sat in
 * Unmatched Forms until staff imported it by hand (B2026-039, -040 and
 * -041, 2026-10-16 to 2026-10-20).
 *
 * This module decides when the held submission so clearly belongs to one
 * existing case that SOLIS attaches it there instead. Attaching only
 * fills the case's empty slot for this form and imports its PDF. It
 * copies NO answers onto the case: the form's values still reach the
 * case only through staff review, exactly as they do for a form that
 * arrived through a link. So a wrong attachment is visible and
 * reversible, never a silent overwrite.
 *
 * Every condition must hold; any doubt leaves the submission for staff:
 *   - exactly one candidate (two possible cases is for a person to decide);
 *   - name AND date of death agree (date of birth alone is not enough:
 *     a date of death is what makes two records the same death);
 *   - the case is not archived;
 *   - the case's slot for THIS form is empty, so an attachment never
 *     displaces a submission already on the case. This also stops a
 *     second First Call from landing on a case that already has one.
 *
 * A date of birth that disagrees does not block attaching — the name and
 * the date of death already identify the death, and in practice the
 * mismatch is a typo on one of the two forms (B2026-041's two forms
 * differ only in the birth year). It is reported so staff check it.
 */

export type ExistingCaseAttachmentDecision =
  | { attach: true; caseId: string; caseNumber: string; dateOfBirthDiffers: boolean }
  | { attach: false; reason: ExistingCaseAttachmentRefusal };

export type ExistingCaseAttachmentRefusal =
  | 'no_single_candidate'
  | 'date_of_death_not_matched'
  | 'case_not_found'
  | 'case_archived'
  | 'form_slot_already_filled';

/** The one candidate this submission can be attached to automatically,
    before the case itself has been loaded. */
export function soleAttachableCandidate(
  candidates: readonly DuplicateCandidate[],
): { candidate: DuplicateCandidate } | { refusal: ExistingCaseAttachmentRefusal } {
  // A synthetic "(lookup unavailable)" candidate carries no case id.
  const real = candidates.filter((c) => c.caseId !== '');
  if (real.length !== 1 || real.length !== candidates.length) return { refusal: 'no_single_candidate' };
  if (!real[0].matchedOn.includes('dateOfDeath')) return { refusal: 'date_of_death_not_matched' };
  return { candidate: real[0] };
}

const UNKNOWN_PLACEHOLDER = '—';
function present(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === UNKNOWN_PLACEHOLDER ? null : trimmed;
}

export function decideExistingCaseAttachment(params: {
  candidates: readonly DuplicateCandidate[];
  mappedFields: Partial<Record<MappedSolisField, string>>;
  /** The candidate case, loaded scoped to the submission's organization. */
  existingCase: Case | null;
  /** That case's form links. */
  caseLinks: readonly CaseFormLink[];
  formConfigId: string;
}): ExistingCaseAttachmentDecision {
  const sole = soleAttachableCandidate(params.candidates);
  if ('refusal' in sole) return { attach: false, reason: sole.refusal };

  const existing = params.existingCase;
  if (!existing || existing.id !== sole.candidate.caseId) return { attach: false, reason: 'case_not_found' };
  // `isDeleted` is how an archived case is recorded (types/case.ts).
  if (existing.isDeleted) return { attach: false, reason: 'case_archived' };

  const slotFilled = params.caseLinks.some(
    (link) => link.caseId === existing.id && link.formConfigId === params.formConfigId && link.submissionId,
  );
  if (slotFilled) return { attach: false, reason: 'form_slot_already_filled' };

  const submittedDob = present(params.mappedFields.dateOfBirth);
  const existingDob = present(existing.dateOfBirth);
  return {
    attach: true,
    caseId: existing.id,
    caseNumber: existing.caseNumber,
    dateOfBirthDiffers: submittedDob !== null && existingDob !== null && submittedDob !== existingDob,
  };
}
