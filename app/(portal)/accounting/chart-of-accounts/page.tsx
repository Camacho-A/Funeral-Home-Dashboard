import { AccountingNav } from '@/components/accounting/AccountingNav';
import { ChartOfAccountsPanel } from '@/components/accounting/ChartOfAccountsPanel';

export default function ChartOfAccountsPage() {
  return (
    <div>
      <h1 className="sx-page-title" style={{ marginBottom: 16 }}>
        Accounting
      </h1>
      <AccountingNav />
      <ChartOfAccountsPanel />
    </div>
  );
}
