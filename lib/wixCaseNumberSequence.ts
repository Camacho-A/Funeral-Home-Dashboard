import { insertWixDataItem, updateWixDataItem, incrementWixDataField, queryWixDataItems, WixDataApiError } from './wixDataApi';
import { formatCaseNumber } from '../domain/cases/caseNumber';

const CASE_SEQUENCES_COLLECTION = 'caseSequences';

type CaseSequenceItem = {
  organizationId: string;
  year: number;
  nextSequence: number;
};

/** Thrown by `initializeCaseSequence` when a row already exists for this
    organization+year and the caller didn't pass `forceOverwrite` — never
    silently reconfigures an active sequence. */
export class CaseSequenceAlreadyInitializedError extends Error {
  constructor(public readonly currentNextSequence: number) {
    super(
      `Case sequence already initialized — next sequence is currently ${currentNextSequence}. Pass forceOverwrite to replace it.`,
    );
  }
}

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

/** Manors launch-prep — P0 automatic case numbering. Reads the current
    `nextSequence` for one organization+year, or `null` if that year's row
    hasn't been created yet (no case has been reserved and no explicit
    initialization has happened) — the "read it back" half of the
    administrator-controlled initialization flow. */
export async function getCaseSequenceState(organizationId: string, year: number): Promise<{ nextSequence: number } | null> {
  const response = await queryWixDataItems<CaseSequenceItem>(CASE_SEQUENCES_COLLECTION, {
    filter: { organizationId, year },
    paging: { limit: 1 },
  });
  const item = response.dataItems[0];
  return item ? { nextSequence: item.data.nextSequence } : null;
}

/**
 * Manors launch-prep — P0 automatic case numbering. The administrator-
 * controlled counterpart to `reserveNextCaseNumber`'s automatic bootstrap:
 * lets an administrator pre-seed a specific organization+year's starting
 * point (e.g. Manor's real external history means 2026 must start at 185,
 * not 1) *before* the first case of that year is reserved. Every future
 * year still rolls over automatically via `reserveNextCaseNumber`'s own
 * bootstrap-at-1 path — this function only ever needs to be called for a
 * transitional year with pre-Beacon history to skip past.
 *
 * Deliberately conservative: a fresh row (no prior initialization, no
 * case ever reserved for this org+year) always succeeds via a plain
 * insert. A row that already exists is never silently replaced —
 * `forceOverwrite` must be passed explicitly, and even then this refuses
 * to move `nextSequence` *backwards* (which would let an already-issued
 * number be handed out again) — the one invariant "no number reuse" the
 * whole feature exists to protect can never be violated through this
 * path either, deliberate override or not. An equal or forward value
 * under `forceOverwrite` is a legitimate, intentional "reset an
 * accidental dev/test sequence to the real production starting number"
 * operation and is allowed.
 */
export async function initializeCaseSequence(
  organizationId: string,
  year: number,
  nextSequence: number,
  options: { forceOverwrite?: boolean } = {},
): Promise<{ nextSequence: number }> {
  const sequenceId = `${organizationId}-${year}`;

  try {
    await insertWixDataItem<CaseSequenceItem>(CASE_SEQUENCES_COLLECTION, { organizationId, year, nextSequence }, sequenceId);
    return { nextSequence };
  } catch (error) {
    if (!(error instanceof WixDataApiError) || error.status !== 409) throw error;
  }

  const existing = await getCaseSequenceState(organizationId, year);
  const currentNextSequence = existing?.nextSequence ?? 0;

  if (!options.forceOverwrite) {
    throw new CaseSequenceAlreadyInitializedError(currentNextSequence);
  }
  if (nextSequence < currentNextSequence) {
    throw new Error(
      `Refusing to move the case-number sequence backwards for ${organizationId}-${year} (requested ${nextSequence}, currently ${currentNextSequence}) — this would allow a previously-issued case number to be reused.`,
    );
  }

  await updateWixDataItem<CaseSequenceItem>(CASE_SEQUENCES_COLLECTION, sequenceId, { organizationId, year, nextSequence });
  return { nextSequence };
}
