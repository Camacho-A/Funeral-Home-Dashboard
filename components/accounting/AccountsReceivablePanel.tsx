'use client';

import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useArAgingReport } from '@/hooks/useAccounting';
import { useCases } from '@/hooks/useCases';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { toDisplayName } from '@/utils/displayName';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
function formatCents(amount: number): string {
  return currency.format(amount / 100);
}

const BUCKET_VARIANT: Record<string, 'neutral' | 'brand' | 'danger'> = {
  '0-30': 'neutral',
  '31-60': 'brand',
  '61-90': 'brand',
  '90+': 'danger',
};

/** SOLIS Final Phase §5.7 — map the existing BUCKET_VARIANT values onto
    the sx- status-dot modifiers, literally: danger→bad, brand→warn,
    neutral→plain (no class). */
const BUCKET_STATUS_CLASS: Record<'neutral' | 'brand' | 'danger', string> = {
  danger: 'sx-status sx-status-bad',
  brand: 'sx-status sx-status-warn',
  neutral: 'sx-status',
};

/**
 * Phase 31 (Financial Management & General Ledger). "Invoices" — a view
 * over the existing `CaseOrder`/`PaymentRecord` data (no new invoice
 * entity, per ADR-035's conflict #1 resolution), aged from each case's v1
 * `CaseOrder`. Reports `reconciles` against the GL's own Accounts
 * Receivable balance — a cross-check surfaced to the user, never a
 * silently-hidden internal detail. Gated `accounting.report`.
 */
export function AccountsReceivablePanel() {
  const { organizationId } = useOrganization();
  const reportQuery = useArAgingReport(organizationId);
  const myPermissionsQuery = useMyPermissions(organizationId);
  // SOLIS Final Phase §5.7 — resolve each row's caseId to a case number and
  // name, the same useCases() lookup pattern Phase 1's RecentActivityPanel
  // uses. A case that doesn't resolve (stale id, cross-org) keeps the
  // pre-existing "Case {caseId}" fallback text exactly as before.
  const casesQuery = useCases();

  if (reportQuery.isPending || myPermissionsQuery.isPending) {
    return <p>Loading accounts receivable…</p>;
  }

  const permissions = myPermissionsQuery.data?.permissions ?? [];
  if (!permissions.includes('accounting.report')) {
    return <EmptyState message="You don't have access to accounts receivable for this organization." />;
  }

  const report = reportQuery.data;
  if (!report || report.rows.length === 0) {
    return <EmptyState message="No open balances — every case is fully paid." />;
  }

  const caseById = new Map((casesQuery.data ?? []).map((c) => [c.id, c]));

  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 16px' }}>Accounts Receivable</h2>
      <div className="sx-kpis" style={{ maxWidth: 420 }}>
        <div className="sx-kpi">
          <span className="sx-kpi-label">Total outstanding</span>
          <span className="sx-kpi-value">{formatCents(report.totalOutstanding)}</span>
        </div>
        <div className="sx-kpi">
          <span className="sx-kpi-label">Open balances</span>
          <span className="sx-kpi-value">{report.rows.length}</span>
        </div>
        {/* Kept additively — not in §5.7's literal summary list, but an
            existing data-integrity signal (does AR match the GL?) this
            phase's spec doesn't say to remove; dropping it would hide a
            legitimate reconciliation-mismatch warning from staff. */}
        <div className="sx-kpi">
          <span className="sx-kpi-label">GL reconciliation</span>
          <Badge variant={report.reconciles ? 'success' : 'danger'}>{report.reconciles ? 'Matches GL' : 'Does not match GL'}</Badge>
        </div>
      </div>
      <table className="sx-table sx-table-stack">
        <thead>
          <tr>
            <th>Case</th>
            <th>Age</th>
            <th>Bucket</th>
            <th className="sx-num">Balance due</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => {
            const resolvedCase = caseById.get(row.caseId);
            return (
              <tr key={row.caseOrderId}>
                <td data-label="Case" data-primary>
                  {resolvedCase ? (
                    <>
                      <a className="sx-link" href={`/cases/${row.caseId}`}>
                        {resolvedCase.caseNumber} · {toDisplayName(resolvedCase.decedentName)}
                      </a>
                      <span className="sx-cell-sub">Anchored {row.anchorDate.slice(0, 10)}</span>
                    </>
                  ) : (
                    `Case ${row.caseId}`
                  )}
                </td>
                <td data-label="Age">{row.ageDays} days</td>
                <td data-label="Bucket">
                  <span className={BUCKET_STATUS_CLASS[BUCKET_VARIANT[row.bucket]]}>{row.bucket}</span>
                </td>
                <td data-label="Balance due" className="sx-num">
                  {formatCents(row.balanceDue)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
