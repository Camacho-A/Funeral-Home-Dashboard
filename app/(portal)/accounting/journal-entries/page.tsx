import { AccountingNav } from '@/components/accounting/AccountingNav';
import { JournalEntriesPanel } from '@/components/accounting/JournalEntriesPanel';

export default function JournalEntriesPage() {
  return (
    <div>
      <h1 className="sx-page-title" style={{ marginBottom: 16 }}>
        Accounting
      </h1>
      <AccountingNav />
      <JournalEntriesPanel />
    </div>
  );
}
