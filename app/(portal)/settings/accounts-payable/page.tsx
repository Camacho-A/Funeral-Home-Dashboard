import { AccountsPayablePanel } from '@/components/settings/AccountsPayablePanel';

/** Phase 36 (Procurement & Accounts Payable). Settings → Accounts Payable.
    Routes enforce ap.read/.manage/.pay (payment separately from manage). */
export default function AccountsPayableSettingsPage() {
  return (
    <div>
      <h1>Accounts Payable</h1>
      <AccountsPayablePanel />
    </div>
  );
}
