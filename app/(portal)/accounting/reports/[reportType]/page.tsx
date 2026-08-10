import { notFound } from 'next/navigation';
import { AccountingNav } from '@/components/accounting/AccountingNav';
import { FinancialReportsPanel, type FinancialReportType } from '@/components/accounting/FinancialReportsPanel';

const VALID_REPORT_TYPES: readonly string[] = ['trial-balance', 'general-ledger', 'balance-sheet', 'profit-and-loss', 'transaction-register'];

export default async function FinancialReportPage({ params }: { params: Promise<{ reportType: string }> }) {
  const { reportType } = await params;
  if (!VALID_REPORT_TYPES.includes(reportType)) notFound();

  return (
    <div>
      <AccountingNav />
      <FinancialReportsPanel reportType={reportType as FinancialReportType} />
    </div>
  );
}
