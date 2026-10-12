import type { Case } from '../../types/case';
import type { MappedSolisField } from './fieldMapping';

/**
 * Form-created case duplicate guard (2026-10).
 *
 * Either the First Call Sheet or the Cremation Arrangement Forms can now
 * create a case, which means the same death can arrive twice — a staff
 * member submits the Arrangement overnight, then enters the First Call
 * the next morning, and nothing links the two.
 *
 * This module answers one narrow question: "does an existing case look
 * enough like this submission that a human should look before SOLIS
 * creates another one?" It NEVER merges, never writes, and never decides
 * that two records are the same person. A candidate only ever suspends
 * automatic creation and routes the submission to the existing Unmatched
 * Forms review queue, where staff link it deliberately.
 *
 * NAME ALONE IS NEVER A MATCH. Funeral homes genuinely see repeated
 * names — family members who share one, and common names in a small
 * county — so a name match on its own would stall legitimate new cases
 * and, worse, invite someone to attach a submission to the wrong
 * decedent. A candidate requires the name AND at least one independent
 * corroborating fact (date of death or date of birth). Two dead people
 * with the same name and the same date of death is the point at which a
 * human should certainly be the one deciding.
 *
 * Deliberately conservative in BOTH directions:
 *   - Too strict and SOLIS creates a duplicate (recoverable: staff
 *     archive one and link the submission to the other).
 *   - Too loose and SOLIS silently refuses to create a legitimate case,
 *     leaving a death unrecorded until someone notices the unmatched row.
 * The corroboration requirement is what keeps the second failure mode
 * from firing on a bare name collision.
 */

export type DuplicateCandidate = {
  caseId: string;
  caseNumber: string;
  decedentName: string;
  /** Which fields corroborated the name — surfaced to staff so the
      review shows WHY this case was flagged, never just that it was. */
  matchedOn: ('dateOfDeath' | 'dateOfBirth')[];
};

/**
 * Normalizes a name for comparison only — never for storage. Collapses
 * case, whitespace and punctuation (O'BRIEN / O Brien / o'brien) so a
 * formatting difference between two forms does not hide a real
 * duplicate. Deliberately NOT a fuzzy/phonetic match: "Jon" and "John"
 * stay different, because guessing is exactly what this module must not
 * do.
 */
export function normalizeNameForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A placeholder the case-creation path stores for an unsupplied field;
    it must never corroborate anything. Mirrors the same marker
    domain/workflow/resolveChecklist.ts already treats as blank. */
const UNKNOWN_PLACEHOLDER = '—';

function meaningful(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === UNKNOWN_PLACEHOLDER) return null;
  return trimmed;
}

/**
 * Existing cases a human should review before SOLIS creates another case
 * for this submission.
 *
 * `cases` must already be scoped to the submission's own organization —
 * this function does no tenant filtering of its own and must never be
 * handed another organization's cases.
 */
export function findDuplicateCandidates(
  mappedFields: Partial<Record<MappedSolisField, string>>,
  cases: readonly Case[],
): DuplicateCandidate[] {
  const submittedName = meaningful(mappedFields.decedentName);
  // No name, no candidate search: there is nothing to anchor a
  // comparison to, and the creation path already refuses to create
  // without a decedent name anyway.
  if (!submittedName) return [];

  const name = normalizeNameForComparison(submittedName);
  if (name === '') return [];

  const submittedDod = meaningful(mappedFields.dateOfDeath);
  const submittedDob = meaningful(mappedFields.dateOfBirth);

  const candidates: DuplicateCandidate[] = [];
  for (const existing of cases) {
    const existingName = meaningful(existing.decedentName);
    if (!existingName || normalizeNameForComparison(existingName) !== name) continue;

    const matchedOn: DuplicateCandidate['matchedOn'] = [];
    const existingDod = meaningful(existing.dateOfDeath);
    const existingDob = meaningful(existing.dateOfBirth);
    if (submittedDod && existingDod && submittedDod === existingDod) matchedOn.push('dateOfDeath');
    if (submittedDob && existingDob && submittedDob === existingDob) matchedOn.push('dateOfBirth');

    // The corroboration requirement. A shared name with no agreeing date
    // is not a candidate — see this module's own header.
    if (matchedOn.length === 0) continue;

    candidates.push({
      caseId: existing.id,
      caseNumber: existing.caseNumber,
      decedentName: existingName,
      matchedOn,
    });
  }

  return candidates;
}
