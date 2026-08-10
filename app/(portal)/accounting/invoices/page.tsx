import { AccountingNav } from '@/components/accounting/AccountingNav';
import { AccountsReceivablePanel } from '@/components/accounting/AccountsReceivablePanel';

export default function InvoicesPage() {
  return (
    <div>
      <AccountingNav />
      <AccountsReceivablePanel />
    </div>
  );
}
