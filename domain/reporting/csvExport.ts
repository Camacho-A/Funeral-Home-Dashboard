/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The one CSV
 * serializer every exporter in Beacon shares — extracted from
 * `services/activityService.ts#exportCsv` (Phase 24), which had the only
 * hand-rolled CSV logic in the codebase before this phase. Pure, no I/O:
 * callers own fetching/pagination/row-capping; this only turns an
 * already-assembled row array into a CSV string.
 *
 * No library dependency — matches this codebase's existing precedent
 * (also true of timezone formatting, `utils/scheduling.ts`) of hand-
 * rolling a genuinely simple format rather than adding a new dependency.
 */

/** A field containing a comma, double quote, or newline must be quoted,
    with any embedded quote doubled — the one RFC 4180 escaping rule this
    codebase's CSV output has ever needed. */
export function escapeCsvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Every CSV export in this codebase caps at this many rows — never an
    unbounded dump of an organization's full history in one response. */
export const EXPORT_ROW_CAP = 10_000;

export type CsvColumn<T> = { header: string; value: (row: T) => string };

/** Builds a complete CSV string (header row + one row per item, `\n`-
    joined) from an already-fetched, already-capped array. Callers apply
    `EXPORT_ROW_CAP` themselves during fetch/pagination — this function
    never re-caps, so a caller that forgets to cap gets an honest error
    surface (a huge string) rather than a silently-truncated one. */
export function buildCsv<T>(rows: readonly T[], columns: ReadonlyArray<CsvColumn<T>>): string {
  const lines = [columns.map((c) => c.header).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvField(c.value(row))).join(','));
  }
  return lines.join('\n');
}
