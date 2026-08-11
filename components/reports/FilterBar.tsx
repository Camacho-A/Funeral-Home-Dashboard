import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import type { StaffProfile } from '@/types/staffProfile';
import type { MetricFilterKey } from '@/domain/reporting/metricRegistry';
import styles from './FilterBar.module.css';

export type ReportFilterValues = {
  fromDate?: string;
  toDate?: string;
  staffProfileId?: string;
};

/**
 * Phase 32 (Reporting, Analytics & Executive Dashboard). The one filter
 * bar every Report Viewer instance shares — only renders the controls a
 * given report's own `defaultFilters`/`allowedFilters` actually name (see
 * `domain/reporting/reportRegistry.ts`), never a generic "show every
 * filter regardless of whether the report can honor it" bar. Date inputs
 * are plain `<input type="date">` values (already ISO `YYYY-MM-DD`), sent
 * straight through — never mixed with a different date field's semantics
 * (see this phase's own "never mix date semantics silently" rule).
 */
export function FilterBar({
  allowedFilters,
  values,
  onChange,
  staffList = [],
}: {
  allowedFilters: readonly MetricFilterKey[];
  values: ReportFilterValues;
  onChange: (next: ReportFilterValues) => void;
  staffList?: StaffProfile[];
}) {
  if (allowedFilters.length === 0) return null;

  return (
    <div className={styles.bar}>
      {allowedFilters.includes('dateRange') && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>From</span>
          <TextField type="date" value={values.fromDate ? values.fromDate.slice(0, 10) : ''} onChange={(e) => onChange({ ...values, fromDate: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined })} />
        </label>
      )}
      {allowedFilters.includes('dateRange') && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>To</span>
          <TextField type="date" value={values.toDate ? values.toDate.slice(0, 10) : ''} onChange={(e) => onChange({ ...values, toDate: e.target.value ? `${e.target.value}T23:59:59.999Z` : undefined })} />
        </label>
      )}
      {allowedFilters.includes('staff') && staffList.length > 0 && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Staff</span>
          <SelectField value={values.staffProfileId ?? ''} onChange={(e) => onChange({ ...values, staffProfileId: e.target.value || undefined })}>
            <option value="">All staff</option>
            {staffList.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.displayName}
              </option>
            ))}
          </SelectField>
        </label>
      )}
    </div>
  );
}
