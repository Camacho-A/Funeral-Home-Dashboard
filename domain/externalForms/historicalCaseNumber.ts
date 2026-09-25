/**
 * Historical Arrangement import — case-number preservation (2026-09).
 * Derives the legitimate, pre-existing Manors case number from a
 * historical Jotform submission's own trusted answers, so it can be
 * preserved onto the new SOLIS Case rather than silently discarded in
 * favor of a fresh, unrelated production number.
 *
 * qid 1 ("CASE NO") is the primary source; qid 198 ("Case No. ", inside
 * the form's separate DC Requisition sub-section) is a secondary
 * cross-check, confirmed via a real submission to normally carry the
 * identical value. qid 251 ("Unique ID") is a Jotform-internal
 * autoincrement counter, NOT a Manors case number, and is deliberately
 * never referenced anywhere in this module.
 *
 * Pure function — never touches a Case, never persists anything, never
 * allocates a production number. Reuses domain/cases/caseNumber.ts's
 * existing `formatCaseNumber` as the SOLE case-number formatting
 * authority — this module never invents a second format.
 */
import { formatCaseNumber } from '@/domain/cases/caseNumber';
import { readAnswerValue, type JotformAnswerMap } from './extractMappedFields';

const QID_CASE_NO_PRIMARY = '1';
const QID_CASE_NO_SECONDARY = '198';

/** The raw historical Jotform format is `YYYY-NNN` (no "B" prefix, a
    pre-Solis manual numbering convention) — a 4-digit year, a dash, and
    a 1-6 digit sequence (generously bounded, then re-padded to Solis's
    own 3-digit-minimum display convention by formatCaseNumber). */
const HISTORICAL_FORMAT_PATTERN = /^(\d{4})-(\d{1,6})$/;

function parseHistoricalRaw(raw: string): { year: number; sequence: number } | null {
  const match = HISTORICAL_FORMAT_PATTERN.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const sequence = Number(match[2]);
  if (year < 2000 || year > 2999) return null;
  if (!Number.isInteger(sequence) || sequence < 1) return null;
  return { year, sequence };
}

export type HistoricalCaseNumberResult =
  | { status: 'ok'; caseNumber: string }
  | { status: 'missing' }
  | { status: 'malformed'; raw: string }
  | { status: 'disagreement'; primary: string; secondary: string };

/**
 * qid 1 is required — its absence or malformed shape always blocks
 * (`missing`/`malformed`), never falls back to qid 198 alone. qid 198 is
 * optional: blank is fine (`ok`, sourced from qid 1); present-but-
 * disagreeing (including present-but-malformed, since a human is meant
 * to be able to cross-check against it) blocks with `disagreement` for
 * manual review — this function never silently picks one side.
 */
export function deriveHistoricalCaseNumber(answers: JotformAnswerMap): HistoricalCaseNumberResult {
  const primaryRaw = readAnswerValue(answers, QID_CASE_NO_PRIMARY);
  if (!primaryRaw) return { status: 'missing' };

  const primaryParsed = parseHistoricalRaw(primaryRaw);
  if (!primaryParsed) return { status: 'malformed', raw: primaryRaw };

  const primaryFormatted = formatCaseNumber(primaryParsed.year, primaryParsed.sequence);

  const secondaryRaw = readAnswerValue(answers, QID_CASE_NO_SECONDARY);
  if (secondaryRaw) {
    const secondaryParsed = parseHistoricalRaw(secondaryRaw);
    if (!secondaryParsed) {
      return { status: 'disagreement', primary: primaryFormatted, secondary: secondaryRaw };
    }
    const secondaryFormatted = formatCaseNumber(secondaryParsed.year, secondaryParsed.sequence);
    if (secondaryFormatted !== primaryFormatted) {
      return { status: 'disagreement', primary: primaryFormatted, secondary: secondaryFormatted };
    }
  }

  return { status: 'ok', caseNumber: primaryFormatted };
}
