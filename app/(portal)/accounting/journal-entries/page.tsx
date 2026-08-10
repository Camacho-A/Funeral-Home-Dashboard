import { AccountingNav } from '@/components/accounting/AccountingNav';
import { JournalEntriesPanel } from '@/components/accounting/JournalEntriesPanel';

export default function JournalEntriesPage() {
  return (
    <div>
      <AccountingNav />
      <JournalEntriesPanel />
    </div>
  );
}
