'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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

function formatCents(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`;
}

export type FinancialReportType = 'trial-balance' | 'general-ledger' | 'balance-sheet' | 'profit-and-loss' | 'transaction-register';

const REPORT_LABEL: Record<FinancialReportType, string> = {
  'trial-balance': 'Trial Balance',
  'general-ledger': 'General Ledger',
  'balance-sheet': 'Balance Sheet',
  'profit-and-loss': 'Profit & Loss',
  'transaction-register': 'Transaction Register',
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
  const router = useRouter();
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
      <div className={styles.toolbar}>
        <SelectField value={reportType} onChange={(e) => router.push(`/accounting/reports/${e.target.value}`)}>
          {(Object.keys(REPORT_LABEL) as FinancialReportType[]).map((key) => (
            <option key={key} value={key}>
              {REPORT_LABEL[key]}
            </option>
          ))}
        </SelectField>
      </div>

      {reportType === 'trial-balance' && (
        <Card className={styles.card}>
          {trialBalanceQuery.isPending ? (
            <p>Loading…</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Account</th>
                  <th className={styles.numeric}>Debit</th>
                  <th className={styles.numeric}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {trialBalanceQuery.data?.rows.map((row) => (
                  <tr key={row.accountId}>
                    <td>
                      {row.accountNumber} — {row.accountName}
                    </td>
                    <td className={styles.numeric}>{row.debitTotal ? formatCents(row.debitTotal) : ''}</td>
                    <td className={styles.numeric}>{row.creditTotal ? formatCents(row.creditTotal) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className={styles.numeric}>{formatCents(trialBalanceQuery.data?.totalDebits ?? 0)}</td>
                  <td className={styles.numeric}>{formatCents(trialBalanceQuery.data?.totalCredits ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      )}

      {reportType === 'general-ledger' && (
        <>
          <SelectField value={selectedAccountId ?? ''} onChange={(e) => setSelectedAccountId(e.target.value || null)} className={styles.accountSelect}>
            <option value="">Select an account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber} — {a.name}
              </option>
            ))}
          </SelectField>
          {selectedAccountId && (
            <Card className={styles.card}>
              {generalLedgerQuery.isPending ? (
                <p>Loading…</p>
              ) : (
                <>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Entry</th>
                        <th>Memo</th>
                        <th className={styles.numeric}>Debit</th>
                        <th className={styles.numeric}>Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generalLedgerQuery.data?.rows.map((row) => (
                        <tr key={row.entryId + row.direction}>
                          <td>{row.entryDate.slice(0, 10)}</td>
                          <td>{row.entryNumber}</td>
                          <td>{row.memo}</td>
                          <td className={styles.numeric}>{row.direction === 'debit' ? formatCents(row.amount) : ''}</td>
                          <td className={styles.numeric}>{row.direction === 'credit' ? formatCents(row.amount) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className={styles.endingBalance}>Ending balance: {formatCents(generalLedgerQuery.data?.endingBalance ?? 0)}</p>
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
              <h3 className={styles.sectionTitle}>Assets</h3>
              {balanceSheetQuery.data?.assets.map((line) => (
                <div key={line.accountId} className={styles.lineRow}>
                  <span>{line.accountName}</span>
                  <span className={styles.numeric}>{formatCents(line.amount)}</span>
                </div>
              ))}
              <div className={styles.lineRowTotal}>
                <span>Total Assets</span>
                <span className={styles.numeric}>{formatCents(balanceSheetQuery.data?.totalAssets ?? 0)}</span>
              </div>

              <h3 className={styles.sectionTitle}>Liabilities</h3>
              {balanceSheetQuery.data?.liabilities.map((line) => (
                <div key={line.accountId} className={styles.lineRow}>
                  <span>{line.accountName}</span>
                  <span className={styles.numeric}>{formatCents(line.amount)}</span>
                </div>
              ))}

              <h3 className={styles.sectionTitle}>Equity</h3>
              {balanceSheetQuery.data?.equity.map((line) => (
                <div key={line.accountId} className={styles.lineRow}>
                  <span>{line.accountName}</span>
                  <span className={styles.numeric}>{formatCents(line.amount)}</span>
                </div>
              ))}
              <div className={styles.lineRow}>
                <span>Net Income (current period)</span>
                <span className={styles.numeric}>{formatCents(balanceSheetQuery.data?.netIncome ?? 0)}</span>
              </div>
              <div className={styles.lineRowTotal}>
                <span>Total Liabilities &amp; Equity</span>
                <span className={styles.numeric}>{formatCents(balanceSheetQuery.data?.totalLiabilitiesAndEquity ?? 0)}</span>
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
              <h3 className={styles.sectionTitle}>Revenue</h3>
              {profitAndLossQuery.data?.revenue.map((line) => (
                <div key={line.accountId} className={styles.lineRow}>
                  <span>{line.accountName}</span>
                  <span className={styles.numeric}>{formatCents(line.amount)}</span>
                </div>
              ))}
              <div className={styles.lineRowTotal}>
                <span>Total Revenue</span>
                <span className={styles.numeric}>{formatCents(profitAndLossQuery.data?.totalRevenue ?? 0)}</span>
              </div>

              <h3 className={styles.sectionTitle}>Expenses</h3>
              {profitAndLossQuery.data?.expenses.map((line) => (
                <div key={line.accountId} className={styles.lineRow}>
                  <span>{line.accountName}</span>
                  <span className={styles.numeric}>{formatCents(line.amount)}</span>
                </div>
              ))}
              <div className={styles.lineRowTotal}>
                <span>Total Expenses</span>
                <span className={styles.numeric}>{formatCents(profitAndLossQuery.data?.totalExpenses ?? 0)}</span>
              </div>

              <div className={styles.lineRowTotal}>
                <span>Net Income</span>
                <span className={styles.numeric}>{formatCents(profitAndLossQuery.data?.netIncome ?? 0)}</span>
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
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Entry</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th className={styles.numeric}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactionRegisterQuery.data?.rows.map((row) => (
                  <tr key={row.entryId}>
                    <td>{row.entryDate.slice(0, 10)}</td>
                    <td>{row.entryNumber}</td>
                    <td>{row.sourceType}</td>
                    <td>{row.relatedDescription ?? row.memo}</td>
                    <td className={styles.numeric}>{formatCents(row.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
