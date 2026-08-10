import { AccountingNav } from '@/components/accounting/AccountingNav';
import { AccountingDashboardPanel } from '@/components/accounting/AccountingDashboardPanel';

export default function AccountingPage() {
  return (
    <div>
      <AccountingNav />
      <AccountingDashboardPanel />
    </div>
  );
}
