import { AccountingNav } from '@/components/accounting/AccountingNav';
import { AccountsReceivablePanel } from '@/components/accounting/AccountsReceivablePanel';

export default function InvoicesPage() {
  return (
    <div>
      <h1 className="sx-page-title" style={{ marginBottom: 16 }}>
        Accounting
      </h1>
      <AccountingNav />
      <AccountsReceivablePanel />
    </div>
  );
}
