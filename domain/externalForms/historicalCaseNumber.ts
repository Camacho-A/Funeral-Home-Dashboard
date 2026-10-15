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
import { formatCaseNumber, resolveCaseNumberPrefix } from '@/domain/cases/caseNumber';
import { readAnswerValue, type JotformAnswerMap } from './extractMappedFields';

const QID_CASE_NO_PRIMARY = '1';
const QID_CASE_NO_SECONDARY = '198';

/** The raw historical Jotform format is `YYYY-NNN` (no prefix, a
    pre-Solis manual numbering convention) — a 4-digit year, a dash, and
    a 1-6 digit sequence (generously bounded, then re-padded to Solis's
    own 3-digit-minimum display convention by formatCaseNumber).

    Organization-specific numbering (2026-10): a raw value MAY also carry
    an explicit 1-3 letter prefix (e.g. `B2026-035`, `m2026-004`). When it
    does, that prefix must equal the importing organization's own prefix —
    a Gus Camacho (M) import can never accept or produce a Manors (B)
    number, and vice versa. */
const HISTORICAL_FORMAT_PATTERN = /^([A-Za-z]{1,3})?(\d{4})-(\d{1,6})$/;

type ParsedHistorical = { prefix: string | null; year: number; sequence: number };

function parseHistoricalRaw(raw: string): ParsedHistorical | null {
  const match = HISTORICAL_FORMAT_PATTERN.exec(raw.trim());
  if (!match) return null;
  const prefix = match[1] ? match[1].toUpperCase() : null;
  const year = Number(match[2]);
  const sequence = Number(match[3]);
  if (year < 2000 || year > 2999) return null;
  if (!Number.isInteger(sequence) || sequence < 1) return null;
  return { prefix, year, sequence };
}

export type HistoricalCaseNumberResult =
  | { status: 'ok'; caseNumber: string }
  | { status: 'missing' }
  | { status: 'malformed'; raw: string }
  | { status: 'disagreement'; primary: string; secondary: string }
  | { status: 'prefix_mismatch'; raw: string; foundPrefix: string; expectedPrefix: string };

/** A staff-facing explanation for a `prefix_mismatch` result — exported so
    every caller words the rejection identically. */
export function describePrefixMismatch(result: { raw: string; foundPrefix: string; expectedPrefix: string }): string {
  return `The historical case number on this submission ("${result.raw}") uses the "${result.foundPrefix}" case-number prefix, but this organization's case numbers use "${result.expectedPrefix}". It cannot be imported into this organization.`;
}

/**
 * qid 1 is required — its absence or malformed shape always blocks
 * (`missing`/`malformed`), never falls back to qid 198 alone. qid 198 is
 * optional: blank is fine (`ok`, sourced from qid 1); present-but-
 * disagreeing (including present-but-malformed, since a human is meant
 * to be able to cross-check against it) blocks with `disagreement` for
 * manual review — this function never silently picks one side.
 *
 * `prefix` is the importing organization's own case-number prefix
 * (resolve it with `resolveCaseNumberPrefix`). Omitted resolves to the
 * legacy default, so existing Manors callers are unchanged. A raw value
 * carrying a DIFFERENT explicit prefix blocks with `prefix_mismatch`.
 */
export function deriveHistoricalCaseNumber(answers: JotformAnswerMap, prefix?: string | null): HistoricalCaseNumberResult {
  const expectedPrefix = resolveCaseNumberPrefix({ caseNumberPrefix: prefix ?? null });

  const primaryRaw = readAnswerValue(answers, QID_CASE_NO_PRIMARY);
  if (!primaryRaw) return { status: 'missing' };

  const primaryParsed = parseHistoricalRaw(primaryRaw);
  if (!primaryParsed) return { status: 'malformed', raw: primaryRaw };
  if (primaryParsed.prefix !== null && primaryParsed.prefix !== expectedPrefix) {
    return { status: 'prefix_mismatch', raw: primaryRaw, foundPrefix: primaryParsed.prefix, expectedPrefix };
  }

  const primaryFormatted = formatCaseNumber(primaryParsed.year, primaryParsed.sequence, expectedPrefix);

  const secondaryRaw = readAnswerValue(answers, QID_CASE_NO_SECONDARY);
  if (secondaryRaw) {
    const secondaryParsed = parseHistoricalRaw(secondaryRaw);
    if (!secondaryParsed) {
      return { status: 'disagreement', primary: primaryFormatted, secondary: secondaryRaw };
    }
    if (secondaryParsed.prefix !== null && secondaryParsed.prefix !== expectedPrefix) {
      return { status: 'prefix_mismatch', raw: secondaryRaw, foundPrefix: secondaryParsed.prefix, expectedPrefix };
    }
    const secondaryFormatted = formatCaseNumber(secondaryParsed.year, secondaryParsed.sequence, expectedPrefix);
    if (secondaryFormatted !== primaryFormatted) {
      return { status: 'disagreement', primary: primaryFormatted, secondary: secondaryFormatted };
    }
  }

  return { status: 'ok', caseNumber: primaryFormatted };
}
