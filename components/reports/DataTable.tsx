import { EmptyState } from '@/components/ui/EmptyState';

export type DataTableColumn<T> = {
  header: string;
  value: (row: T) => string;
  /** SOLIS Final Phase §4.2 — explicit numeric/currency flag. When omitted,
      falls back to matching the header text against the same Cents/Count/
      Total/Amount convention the spec names for a column *key* (this
      table has no field-key concept, only a display header). */
  numeric?: boolean;
};

const NUMERIC_HEADER_FALLBACK = /\b(cents|count|total|amount|balance|debit|credit|age)\b/i;

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The generic
 * tabular renderer every report-registry row shape (financial report
 * rows, staff workload rows, stage-breakdown rows, ...) shares — never a
 * bespoke table per report. Renders the same `EmptyState` convention
 * every other list/table in this codebase already uses when there's no data.
 *
 * SOLIS Final Phase §4.2 (2026-10): `.sx-table` inside `.sx-table-wrap`,
 * horizontal scroll kept on mobile (never stacked, per spec) — presentation
 * only, same rows/columns contract.
 */
export function DataTable<T>({ rows, columns, emptyMessage = 'No data for this range.' }: { rows: readonly T[]; columns: ReadonlyArray<DataTableColumn<T>>; emptyMessage?: string }) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;

  return (
    <div className="sx-table-wrap">
      <table className="sx-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.header} scope="col" className={col.numeric ?? NUMERIC_HEADER_FALLBACK.test(col.header) ? 'sx-num' : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((col) => (
                <td key={col.header} className={col.numeric ?? NUMERIC_HEADER_FALLBACK.test(col.header) ? 'sx-num' : undefined}>
                  {col.value(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
