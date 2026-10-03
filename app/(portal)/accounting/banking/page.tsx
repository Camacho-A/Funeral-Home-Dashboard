import { AccountingNav } from '@/components/accounting/AccountingNav';
import { BankingPanel } from '@/components/accounting/BankingPanel';

export default function BankingPage() {
  return (
    <div>
      <h1 className="sx-page-title" style={{ marginBottom: 16 }}>
        Accounting
      </h1>
      <AccountingNav />
      <BankingPanel />
    </div>
  );
}
