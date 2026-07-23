import { insertWixDataItem, incrementWixDataField, WixDataApiError } from './wixDataApi';
import { formatCaseNumber } from '../domain/cases/caseNumber';

const CASE_SEQUENCES_COLLECTION = 'caseSequences';

type CaseSequenceItem = {
  organizationId: string;
  year: number;
  nextSequence: number;
};

/**
 * Phase 16B (Case Number Generation). Reserves and returns the next Case
 * Number for one organization/year, backed by a dedicated `caseSequences`
 * Wix collection (one row per organization+year, `_id` set to
 * `{organizationId}-{year}` — the same "system _id doubles as the natural
 * key" convention already used for `cases`/`tasks`, so no compound unique
 * index is needed). See docs/adr/ADR-018-case-number-generation.md for the
 * full design and the empirical verification (against the live Wix
 * project) that this is genuinely concurrency-safe:
 *
 * - The common path is a single atomic `INCREMENT_FIELD` patch on the
 *   existing row — Wix Data guarantees no lost updates across concurrent
 *   patches on the same item, which is exactly the "server-side... or
 *   equivalent concurrency-safe mechanism" this feature requires. The
 *   claimed number is the value *before* the increment (`nextSequence - 1`
 *   after the patch), so the row always holds "the next number to hand
 *   out," never "the last one given out."
 * - The one-time bootstrap case (the year's first case for this
 *   organization, so the row doesn't exist yet) tries to INSERT the row
 *   with `nextSequence: 2`, claiming sequence 1 for itself. If two
 *   requests race to do this, Wix's own `_id` uniqueness means only one
 *   insert can succeed (confirmed live: the loser gets HTTP 409); the
 *   loser falls back to the atomic-increment path, which is now safe
 *   since the row exists — so no two callers can ever be handed the same
 *   number, however many race at once.
 */
export async function reserveNextCaseNumber(organizationId: string, year: number): Promise<string> {
  const sequenceId = `${organizationId}-${year}`;

  try {
    const patched = await incrementWixDataField<CaseSequenceItem>(
      CASE_SEQUENCES_COLLECTION,
      sequenceId,
      'nextSequence',
      1,
    );
    return formatCaseNumber(year, patched.data.nextSequence - 1);
  } catch (error) {
    if (!(error instanceof WixDataApiError) || error.status !== 404) {
      throw error;
    }
  }

  // The row didn't exist — this is the first case of the year for this
  // organization. Claim sequence 1 by creating the row directly, leaving
  // nextSequence at 2 for whichever request claims the next one.
  try {
    await insertWixDataItem<CaseSequenceItem>(
      CASE_SEQUENCES_COLLECTION,
      { organizationId, year, nextSequence: 2 },
      sequenceId,
    );
    return formatCaseNumber(year, 1);
  } catch (error) {
    if (!(error instanceof WixDataApiError) || error.status !== 409) {
      throw error;
    }
  }

  // Someone else won the race to create the row first — it exists now, so
  // the atomic increment path is safe to retry.
  const patched = await incrementWixDataField<CaseSequenceItem>(
    CASE_SEQUENCES_COLLECTION,
    sequenceId,
    'nextSequence',
    1,
  );
  return formatCaseNumber(year, patched.data.nextSequence - 1);
}
