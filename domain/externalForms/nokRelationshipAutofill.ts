import type { Case, NextOfKinRelationship } from '@/types/case';
import type { MappedSolisField } from './fieldMapping';

/**
 * Next of Kin relationship from the Arrangement Forms (2026-10).
 *
 * Manors cases are created from the First Call Sheet, which has no
 * relationship question, so a case starts with the relationship blank. The
 * Arrangement Form that arrives later DOES carry it (qid 225 when the
 * Informant is the Next of Kin, qid 279 otherwise — see
 * arrangementNokDerivation.ts), but it only ever reached the case if staff
 * opened the review window and applied it. This decides when it is filled
 * in automatically. Pure — the service does the write.
 *
 *   apply   the case's relationship is blank, the form names one that is
 *           an exact SOLIS option, and the form's Next of Kin is the same
 *           person as the case's;
 *   keep    the case already has a relationship — a staff choice or an
 *           earlier form is never overwritten (a duplicate or late
 *           submission changes nothing);
 *   review  something prevents a safe fill — the submitted value has no
 *           matching SOLIS option, or the form's Next of Kin is not the
 *           case's — nothing is written and the value is kept for staff;
 *   none    the form gives no relationship; the manual workflow stays.
 */
export type NokRelationshipDecision =
  | { action: 'apply'; relationship: NextOfKinRelationship; source: string }
  | { action: 'keep'; current: NextOfKinRelationship; source: string | null; differs: boolean }
  | { action: 'review'; reason: 'unmapped_value' | 'different_person' | 'no_case_contact'; source: string; relationship: NextOfKinRelationship | null }
  | { action: 'none' };

/** Same person, allowing for capitals, spacing and punctuation only. */
export function sameContactName(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalize = (value: string | null | undefined) =>
    (value ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const left = normalize(a);
  return left !== '' && left === normalize(b);
}

export function decideNokRelationshipAutofill(
  case_: Pick<Case, 'nextOfKinName' | 'nextOfKinRelationship'>,
  mapped: Partial<Record<MappedSolisField, string>>,
): NokRelationshipDecision {
  const source = mapped.nextOfKinRelationshipSource?.trim() || null;
  const relationship = (mapped.nextOfKinRelationship as NextOfKinRelationship | undefined) ?? null;
  if (!source && !relationship) return { action: 'none' };

  if (case_.nextOfKinRelationship) {
    return { action: 'keep', current: case_.nextOfKinRelationship, source, differs: relationship !== null && relationship !== case_.nextOfKinRelationship };
  }
  const submitted = source ?? relationship!;
  if (!relationship) return { action: 'review', reason: 'unmapped_value', source: submitted, relationship: null };
  if (!case_.nextOfKinName?.trim()) return { action: 'review', reason: 'no_case_contact', source: submitted, relationship };
  if (!sameContactName(case_.nextOfKinName, mapped.nextOfKinName)) return { action: 'review', reason: 'different_person', source: submitted, relationship };
  return { action: 'apply', relationship, source: submitted };
}

export const NOK_RELATIONSHIP_REVIEW_REASON: Record<'unmapped_value' | 'different_person' | 'no_case_contact', string> = {
  unmapped_value: 'it does not match any SOLIS relationship option',
  different_person: "the form's Next of Kin is not the same person as the case's Next of Kin",
  no_case_contact: 'the case has no Next of Kin name to attach it to',
};
