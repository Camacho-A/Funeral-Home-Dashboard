import { EmptyState } from '@/components/ui/EmptyState';
import styles from './DataTable.module.css';

export type DataTableColumn<T> = { header: string; value: (row: T) => string };

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The generic
 * tabular renderer every report-registry row shape (financial report
 * rows, staff workload rows, stage-breakdown rows, ...) shares — never a
 * bespoke table per report. Renders the same `EmptyState` convention
 * every other list/table in this codebase already uses when there's no data.
 */
export function DataTable<T>({ rows, columns, emptyMessage = 'No data for this range.' }: { rows: readonly T[]; columns: ReadonlyArray<DataTableColumn<T>>; emptyMessage?: string }) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.header} scope="col">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((col) => (
                <td key={col.header}>{col.value(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
