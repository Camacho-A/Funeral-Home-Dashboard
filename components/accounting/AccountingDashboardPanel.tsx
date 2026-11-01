'use client';

import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useBalanceSheetReport, useArAgingReport, useJournalEntries } from '@/hooks/useAccounting';
import { EmptyState } from '@/components/ui/EmptyState';
import { useOrganizationRecord } from '@/hooks/useOrganizationRecord';
import { isModuleHidden } from '@/domain/organization/moduleVisibility';
import { getRegisteredOrganizationProfile } from '@/domain/organization/organizationProfiles';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
function formatCents(amount: number): string {
  return currency.format(amount / 100);
}

/**
 * Phase 31 (Financial Management & General Ledger). The Accounting
 * subsystem's landing page: cash position (Balance Sheet's own asset
 * total — every derived account balance, never a stored figure), open AR,
 * and manual entries still awaiting review/posting. Gated
 * `accounting.view`.
 */
export function AccountingDashboardPanel() {
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const balanceSheetQuery = useBalanceSheetReport(organizationId);
  const arAgingQuery = useArAgingReport(organizationId);
  const { data: organization } = useOrganizationRecord();
  // An organization that hides Journal Entries AND enforces hidden modules
  // server-side (Gus) gets neither the pending-drafts KPI/section nor its
  // link, and the (server-refused) request is never made. Organizations
  // with nav-only hiding (Manors) keep the panel exactly as before.
  const journalEntriesVisible = !(
    getRegisteredOrganizationProfile(organizationId).features.enforceHiddenModulesServerSide &&
    isModuleHidden(
      { id: organizationId, hiddenModules: organization?.hiddenModules ?? null },
      'accounting-journal-entries',
    )
  );
  const journalEntriesQuery = useJournalEntries(organizationId, { enabled: journalEntriesVisible });

  if (
    myPermissionsQuery.isPending ||
    balanceSheetQuery.isPending ||
    arAgingQuery.isPending ||
    (journalEntriesVisible && journalEntriesQuery.isPending)
  ) {
    return <p>Loading accounting dashboard…</p>;
  }

  const permissions = myPermissionsQuery.data?.permissions ?? [];
  if (!permissions.includes('accounting.view')) {
    return (
      <EmptyState message="You don't have access to the accounting dashboard for this organization." />
    );
  }

  const cashPosition = (balanceSheetQuery.data?.assets ?? []).reduce(
    (sum, line) => sum + line.amount,
    0,
  );
  const openAr = arAgingQuery.data?.totalOutstanding ?? 0;
  const draftEntries = (journalEntriesQuery.data ?? []).filter((e) => e.status === 'draft');

  return (
    <div>
      <div className="sx-kpis">
        <div className="sx-kpi">
          <span className="sx-kpi-label">Cash position</span>
          <span className="sx-kpi-value">{formatCents(cashPosition)}</span>
        </div>
        <div className="sx-kpi">
          <span className="sx-kpi-label">Open accounts receivable</span>
          <span className="sx-kpi-value">{formatCents(openAr)}</span>
        </div>
        {journalEntriesVisible ? (
          <div className="sx-kpi">
            <span className="sx-kpi-label">Entries pending review</span>
            <span className="sx-kpi-value">{draftEntries.length}</span>
          </div>
        ) : null}
      </div>

      {journalEntriesVisible ? (
        <>
          <h2 className="sx-section-title">
            Drafts pending review
            <a
              href="/accounting/journal-entries"
              className="sx-link"
              style={{ fontSize: 12.5, fontWeight: 500 }}
            >
              Journal entries →
            </a>
          </h2>
          {draftEntries.length === 0 ? (
            <EmptyState message="No manual entries are waiting for review." />
          ) : (
            <table className="sx-table">
              <tbody>
                {draftEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="sx-mono">{entry.entryDate.slice(0, 10)}</td>
                    <td>{entry.memo}</td>
                    <td>
                      <span className="sx-status">Draft</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </div>
  );
}
