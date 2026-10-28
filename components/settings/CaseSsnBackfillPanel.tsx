'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { runCaseSsnBackfill, type CaseSsnBackfillReport } from '@/lib/caseSsnClient';

/**
 * Case SSN — one-time fill for existing cases (2026-10). Administrators
 * only (the API checks `organization.manage`). Preview first: it reads each
 * active case's linked Arrangement Form (else Vital Statistics form) and
 * changes nothing. "Fill now" then saves and locks the SSN on each case
 * that has none — never replacing one already on file, never an archived
 * case. Only case numbers are shown here, never a digit of an SSN.
 */
const OUTCOME_LABEL: Record<CaseSsnBackfillReport['cases'][number]['outcome'], string> = {
  would_save: 'Will be saved',
  saved: 'Saved and locked',
  already_on_file: 'Already on file',
  none_found: 'No SSN on its forms — enter it from the case',
};

export function CaseSsnBackfillPanel() {
  const { organizationId } = useOrganization();
  const [report, setReport] = useState<CaseSsnBackfillReport | null>(null);
  const [busy, setBusy] = useState<'preview' | 'fill' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'fill');
    setError(null);
    try {
      setReport(await runCaseSsnBackfill(organizationId, dryRun));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The fill could not be completed.');
    } finally {
      setBusy(null);
    }
  }

  const previewed = report?.dryRun === true;
  return (
    <div className="sx-form-grid">
      <section className="sx-span-all">
        <h2 className="sx-section-title">Fill Social Security numbers for existing cases</h2>
        <p>
          New cases save the SSN when their Arrangement Form arrives. This reads each existing active case&rsquo;s own Arrangement Form
          (or Vital Statistics form) once and saves the SSN — encrypted and locked, last four digits shown. A case that already has
          one is left as it is; archived cases are not changed.
        </p>
        {error && (
          <div className="sx-form-banner sx-form-banner-error" role="alert">
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="sx-btn sx-btn-secondary" onClick={() => run(true)} disabled={busy !== null}>
            {busy === 'preview' ? 'Checking…' : 'Preview'}
          </button>
          <button type="button" className="sx-btn sx-btn-primary" onClick={() => run(false)} disabled={busy !== null || !previewed || report.counts.would_save === 0}>
            {busy === 'fill' ? 'Saving…' : previewed ? `Fill now (${report.counts.would_save})` : 'Fill now'}
          </button>
        </div>
        {!previewed && !report && <p className="sx-help">Preview first — it changes nothing.</p>}
      </section>

      {report && (
        <section className="sx-span-all" aria-live="polite">
          <p>
            {report.dryRun ? 'Preview' : 'Done'}: {report.checked} active cases checked —{' '}
            {report.dryRun ? `${report.counts.would_save} will be saved` : `${report.counts.saved} saved`}, {report.counts.already_on_file} already on
            file, {report.counts.none_found} with no SSN on their forms.
          </p>
          <table className="sx-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {report.cases.map((row) => (
                <tr key={row.caseNumber}>
                  <td>{row.caseNumber}</td>
                  <td>{OUTCOME_LABEL[row.outcome]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
