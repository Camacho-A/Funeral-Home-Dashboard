'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import {
  useTrialBalanceReport,
  useBalanceSheetReport,
  useProfitAndLossReport,
  useTransactionRegisterReport,
  useGeneralLedgerReport,
  useChartOfAccounts,
} from '@/hooks/useAccounting';
import { Card } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './FinancialReportsPanel.module.css';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
function formatCents(amount: number): string {
  return currency.format(amount / 100);
}

export type FinancialReportType = 'trial-balance' | 'general-ledger' | 'balance-sheet' | 'profit-and-loss' | 'transaction-register';

const REPORT_LABEL: Record<FinancialReportType, string> = {
  'trial-balance': 'Trial Balance',
  'general-ledger': 'General Ledger',
  'balance-sheet': 'Balance Sheet',
  'profit-and-loss': 'Profit & Loss',
  'transaction-register': 'Transaction Register',
};

/** SOLIS Final Phase §5.8 — short description per report, shown under its
    header. Presentation only; no field/calculation named here. */
const REPORT_DESCRIPTION: Record<FinancialReportType, string> = {
  'trial-balance': 'Every account’s debit and credit balance, as of now.',
  'general-ledger': 'Every posted transaction for one account, in order.',
  'balance-sheet': 'Assets, liabilities and equity as of now.',
  'profit-and-loss': 'Revenue and expenses for the current period.',
  'transaction-register': 'Every posted entry across the ledger, newest first.',
};

/**
 * Phase 31 (Financial Management & General Ledger). 5 of the 6 financial
 * reports (AR Aging has its own dedicated "Invoices" page — see
 * `AccountsReceivablePanel.tsx`, since it's a case-scoped view rather than
 * a pure-GL one). Server-backed, not the flat client-`useMemo` shape the
 * pre-existing `/reports` page uses (see ADR-035's conflict #7 — these
 * aggregate potentially large ledger history server-side). Gated
 * `accounting.report`.
 */
export function FinancialReportsPanel({ reportType }: { reportType: FinancialReportType }) {
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const chartOfAccountsQuery = useChartOfAccounts(organizationId);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const trialBalanceQuery = useTrialBalanceReport(organizationId);
  const balanceSheetQuery = useBalanceSheetReport(organizationId);
  const profitAndLossQuery = useProfitAndLossReport(organizationId);
  const transactionRegisterQuery = useTransactionRegisterReport(organizationId);
  const generalLedgerQuery = useGeneralLedgerReport(organizationId, selectedAccountId);

  if (myPermissionsQuery.isPending || chartOfAccountsQuery.isPending) {
    return <p>Loading reports…</p>;
  }

  const permissions = myPermissionsQuery.data?.permissions ?? [];
  if (!permissions.includes('accounting.report')) {
    return <EmptyState message="You don't have access to financial reports for this organization." />;
  }

  const accounts = chartOfAccountsQuery.data ?? [];

  return (
    <div>
      <nav aria-label="Financial reports" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {(Object.keys(REPORT_LABEL) as FinancialReportType[]).map((key) => {
          const isActive = key === reportType;
          return (
            <Link
              key={key}
              href={`/accounting/reports/${key}`}
              aria-current={isActive ? 'page' : undefined}
              style={{
                height: 30,
                padding: '0 12px',
                borderRadius: 7,
                fontSize: 13,
                display: 'inline-flex',
                alignItems: 'center',
                textDecoration: 'none',
                background: isActive ? 'var(--sx-navy-tint)' : undefined,
                color: isActive ? 'oklch(0.28 0.08 255)' : 'var(--sx-text-2)',
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {REPORT_LABEL[key]}
            </Link>
          );
        })}
      </nav>

      <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px' }}>{REPORT_LABEL[reportType]}</h2>
      <p className="sx-page-desc" style={{ margin: '0 0 20px' }}>
        {REPORT_DESCRIPTION[reportType]}
      </p>

      {reportType === 'trial-balance' && (
        <Card className={styles.card}>
          {trialBalanceQuery.isPending ? (
            <p>Loading…</p>
          ) : (
            <div className="sx-table-wrap" style={{ maxWidth: 820 }}>
              <table className="sx-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="sx-num">Debit</th>
                    <th className="sx-num">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalanceQuery.data?.rows.map((row) => (
                    <tr key={row.accountId}>
                      <td>
                        {row.accountNumber} — {row.accountName}
                      </td>
                      <td className="sx-num">{row.debitTotal ? formatCents(row.debitTotal) : ''}</td>
                      <td className="sx-num">{row.creditTotal ? formatCents(row.creditTotal) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="sx-num">{formatCents(trialBalanceQuery.data?.totalDebits ?? 0)}</td>
                    <td className="sx-num">{formatCents(trialBalanceQuery.data?.totalCredits ?? 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      {reportType === 'general-ledger' && (
        <>
          <label className="sx-filter" style={{ marginBottom: 16 }}>
            <span className="sx-filter-label">Account</span>
            <SelectField className="sx-select" value={selectedAccountId ?? ''} onChange={(e) => setSelectedAccountId(e.target.value || null)} style={{ width: 280 }}>
              <option value="">Select an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountNumber} — {a.name}
                </option>
              ))}
            </SelectField>
          </label>
          {selectedAccountId && (
            <Card className={styles.card}>
              {generalLedgerQuery.isPending ? (
                <p>Loading…</p>
              ) : (
                <>
                  <div className="sx-table-wrap" style={{ maxWidth: 820 }}>
                    <table className="sx-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Entry</th>
                          <th>Memo</th>
                          <th className="sx-num">Debit</th>
                          <th className="sx-num">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {generalLedgerQuery.data?.rows.map((row) => (
                          <tr key={row.entryId + row.direction}>
                            <td>{row.entryDate.slice(0, 10)}</td>
                            <td>{row.entryNumber}</td>
                            <td>{row.memo}</td>
                            <td className="sx-num">{row.direction === 'debit' ? formatCents(row.amount) : ''}</td>
                            <td className="sx-num">{row.direction === 'credit' ? formatCents(row.amount) : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="sx-help" style={{ marginTop: 6 }}>
                    Ending balance: {formatCents(generalLedgerQuery.data?.endingBalance ?? 0)}
                  </p>
                </>
              )}
            </Card>
          )}
        </>
      )}

      {reportType === 'balance-sheet' && (
        <Card className={styles.card}>
          {balanceSheetQuery.isPending ? (
            <p>Loading…</p>
          ) : (
            <>
              <h3 className="sx-section-title" style={{ marginTop: 24 }}>Assets</h3>
              {balanceSheetQuery.data?.assets.map((line) => (
                <div key={line.accountId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', minHeight: 40, alignItems: 'center', borderBottom: '1px solid var(--sx-border-soft)', fontSize: 13.5 }}>
                  <span>{line.accountName}</span>
                  <span className="sx-num">{formatCents(line.amount)}</span>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', minHeight: 40, alignItems: 'center', fontSize: 13.5, fontWeight: 600, borderTop: '1px solid var(--sx-border)' }}>
                <span>Total Assets</span>
                <span className="sx-num">{formatCents(balanceSheetQuery.data?.totalAssets ?? 0)}</span>
              </div>

              <h3 className="sx-section-title" style={{ marginTop: 24 }}>Liabilities</h3>
              {balanceSheetQuery.data?.liabilities.map((line) => (
                <div key={line.accountId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', minHeight: 40, alignItems: 'center', borderBottom: '1px solid var(--sx-border-soft)', fontSize: 13.5 }}>
                  <span>{line.accountName}</span>
                  <span className="sx-num">{formatCents(line.amount)}</span>
                </div>
              ))}

              <h3 className="sx-section-title" style={{ marginTop: 24 }}>Equity</h3>
              {balanceSheetQuery.data?.equity.map((line) => (
                <div key={line.accountId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', minHeight: 40, alignItems: 'center', borderBottom: '1px solid var(--sx-border-soft)', fontSize: 13.5 }}>
                  <span>{line.accountName}</span>
                  <span className="sx-num">{formatCents(line.amount)}</span>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', minHeight: 40, alignItems: 'center', borderBottom: '1px solid var(--sx-border-soft)', fontSize: 13.5 }}>
                <span>Net Income (current period)</span>
                <span className="sx-num">{formatCents(balanceSheetQuery.data?.netIncome ?? 0)}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', minHeight: 40, alignItems: 'center', fontSize: 13.5, fontWeight: 600, borderTop: '1px solid var(--sx-border)' }}>
                <span>Total Liabilities &amp; Equity</span>
                <span className="sx-num">{formatCents(balanceSheetQuery.data?.totalLiabilitiesAndEquity ?? 0)}</span>
              </div>
            </>
          )}
        </Card>
      )}

      {reportType === 'profit-and-loss' && (
        <Card className={styles.card}>
          {profitAndLossQuery.isPending ? (
            <p>Loading…</p>
          ) : (
            <>
              <h3 className="sx-section-title" style={{ marginTop: 24 }}>Revenue</h3>
              {profitAndLossQuery.data?.revenue.map((line) => (
                <div key={line.accountId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', minHeight: 40, alignItems: 'center', borderBottom: '1px solid var(--sx-border-soft)', fontSize: 13.5 }}>
                  <span>{line.accountName}</span>
                  <span className="sx-num">{formatCents(line.amount)}</span>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', minHeight: 40, alignItems: 'center', fontSize: 13.5, fontWeight: 600, borderTop: '1px solid var(--sx-border)' }}>
                <span>Total Revenue</span>
                <span className="sx-num">{formatCents(profitAndLossQuery.data?.totalRevenue ?? 0)}</span>
              </div>

              <h3 className="sx-section-title" style={{ marginTop: 24 }}>Expenses</h3>
              {profitAndLossQuery.data?.expenses.map((line) => (
                <div key={line.accountId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', minHeight: 40, alignItems: 'center', borderBottom: '1px solid var(--sx-border-soft)', fontSize: 13.5 }}>
                  <span>{line.accountName}</span>
                  <span className="sx-num">{formatCents(line.amount)}</span>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', minHeight: 40, alignItems: 'center', fontSize: 13.5, fontWeight: 600, borderTop: '1px solid var(--sx-border)' }}>
                <span>Total Expenses</span>
                <span className="sx-num">{formatCents(profitAndLossQuery.data?.totalExpenses ?? 0)}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', minHeight: 40, alignItems: 'center', fontSize: 13.5, fontWeight: 600, borderTop: '1px solid var(--sx-border)' }}>
                <span>Net Income</span>
                <span className="sx-num">{formatCents(profitAndLossQuery.data?.netIncome ?? 0)}</span>
              </div>
            </>
          )}
        </Card>
      )}

      {reportType === 'transaction-register' && (
        <Card className={styles.card}>
          {transactionRegisterQuery.isPending ? (
            <p>Loading…</p>
          ) : transactionRegisterQuery.data?.rows.length === 0 ? (
            <EmptyState message="No transactions have been posted yet." />
          ) : (
            <div className="sx-table-wrap" style={{ maxWidth: 820 }}>
            <table className="sx-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Entry</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th className="sx-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactionRegisterQuery.data?.rows.map((row) => (
                  <tr key={row.entryId}>
                    <td>{row.entryDate.slice(0, 10)}</td>
                    <td>{row.entryNumber}</td>
                    <td>{row.sourceType}</td>
                    <td>{row.relatedDescription ?? row.memo}</td>
                    <td className="sx-num">{formatCents(row.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
