import { AccountingNav } from '@/components/accounting/AccountingNav';
import { AccountingDashboardPanel } from '@/components/accounting/AccountingDashboardPanel';

export default function AccountingPage() {
  return (
    <div>
      <h1 className="sx-page-title" style={{ marginBottom: 16 }}>
        Accounting
      </h1>
      <AccountingNav />
      <AccountingDashboardPanel />
    </div>
  );
}
