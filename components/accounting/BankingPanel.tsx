'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useBankAccounts, useCreateBankAccount, useDeactivateBankAccount, useChartOfAccounts, useBankDeposits } from '@/hooks/useAccounting';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
function formatCents(amount: number): string {
  return currency.format(amount / 100);
}

/**
 * Phase 31 (Financial Management & General Ledger). Bank account
 * management + a read-only deposit history — deposit *creation* happens
 * from the payments workflow, not here (see
 * `services/financialTransactionService.ts#postDepositTransaction`'s own
 * comment on why `bankingService.ts` owns account management/statement
 * import/reconciliation, never deposit creation). `.view` gates reading;
 * `.manage` gates account create/deactivate.
 */
export function BankingPanel() {
  const { organizationId } = useOrganization();
  const bankAccountsQuery = useBankAccounts(organizationId);
  const chartOfAccountsQuery = useChartOfAccounts(organizationId);
  const depositsQuery = useBankDeposits(organizationId);
  const myPermissionsQuery = useMyPermissions(organizationId);
  const createBankAccount = useCreateBankAccount(organizationId);
  const deactivateBankAccount = useDeactivateBankAccount(organizationId);

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [bankName, setBankName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (bankAccountsQuery.isPending || chartOfAccountsQuery.isPending || depositsQuery.isPending || myPermissionsQuery.isPending) {
    return <p>Loading banking…</p>;
  }

  const permissions = myPermissionsQuery.data?.permissions ?? [];
  const canView = permissions.includes('accounting.view');
  const canManage = permissions.includes('accounting.manage');

  if (!canView) {
    return <EmptyState message="You don't have access to banking for this organization." />;
  }

  const bankAccounts = bankAccountsQuery.data ?? [];
  const assetAccounts = (chartOfAccountsQuery.data ?? []).filter((a) => a.accountType === 'asset');
  const deposits = [...(depositsQuery.data ?? [])].sort((a, b) => (a.depositDate < b.depositDate ? 1 : -1));

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createBankAccount.mutateAsync({ name, ledgerAccountId, bankName: bankName || null });
      setName('');
      setLedgerAccountId('');
      setBankName('');
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bank account.');
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h2 className="sx-section-title">
        Bank accounts
        {canManage && (
          <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? 'Cancel' : '+ New Bank Account'}
          </button>
        )}
      </h2>

      {formOpen && canManage && (
        <div style={{ border: '1px solid var(--sx-border)', borderRadius: 10, padding: '16px 18px', marginBottom: 24 }}>
          <form onSubmit={handleCreate} className="sx-form-grid sx-form-grid-3">
            <TextField className="sx-input" placeholder="Name (e.g. Operating)" value={name} onChange={(e) => setName(e.target.value)} required />
            <SelectField className="sx-select" value={ledgerAccountId} onChange={(e) => setLedgerAccountId(e.target.value)} required>
              <option value="">Linked ledger account…</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountNumber} — {a.name}
                </option>
              ))}
            </SelectField>
            <TextField className="sx-input" placeholder="Bank name (optional)" value={bankName} onChange={(e) => setBankName(e.target.value)} />
            <button type="submit" className="sx-btn sx-btn-primary">
              Create
            </button>
          </form>
          {error && <p className="sx-error">{error}</p>}
        </div>
      )}

      {bankAccounts.length === 0 ? (
        <EmptyState message="No bank accounts have been added yet." />
      ) : (
        <table className="sx-table">
          <tbody>
            {bankAccounts.map((account) => (
              <tr key={account.id}>
                <td>
                  <span className="sx-cell-title">{account.name}</span>
                  <span className="sx-cell-sub">{account.bankName ?? 'No bank name on file'}</span>
                </td>
                <td>
                  <span className={account.isActive ? 'sx-status sx-status-ok' : 'sx-status'}>{account.isActive ? 'Active' : 'Inactive'}</span>
                </td>
                <td>
                  {canManage && account.isActive && (
                    <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => deactivateBankAccount.mutate(account.id)}>
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="sx-section-title" style={{ marginTop: 28 }}>
        Deposit history
        <span className="sx-section-meta">{deposits.length} deposits</span>
      </h2>
      {deposits.length === 0 ? (
        <EmptyState message="No deposits have been recorded yet." />
      ) : (
        <table className="sx-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Payments included</th>
              <th className="sx-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {deposits.map((deposit) => (
              <tr key={deposit.id}>
                <td className="sx-mono">{deposit.depositDate.slice(0, 10)}</td>
                <td>{deposit.includedPaymentRecordIds.length} payment(s)</td>
                <td className="sx-num">{formatCents(deposit.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
