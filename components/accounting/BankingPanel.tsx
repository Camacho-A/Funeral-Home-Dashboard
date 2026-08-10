'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useBankAccounts, useCreateBankAccount, useDeactivateBankAccount, useChartOfAccounts, useBankDeposits } from '@/hooks/useAccounting';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './BankingPanel.module.css';

function formatCents(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`;
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
    <div>
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Bank Accounts</h2>
        <div className={styles.spacer} />
        {canManage && <Button onClick={() => setFormOpen((v) => !v)}>{formOpen ? 'Cancel' : '+ New Bank Account'}</Button>}
      </div>

      {formOpen && canManage && (
        <Card className={styles.form}>
          <form onSubmit={handleCreate} className={styles.formRow}>
            <TextField placeholder="Name (e.g. Operating)" value={name} onChange={(e) => setName(e.target.value)} required />
            <SelectField value={ledgerAccountId} onChange={(e) => setLedgerAccountId(e.target.value)} required>
              <option value="">Linked ledger account…</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountNumber} — {a.name}
                </option>
              ))}
            </SelectField>
            <TextField placeholder="Bank name (optional)" value={bankName} onChange={(e) => setBankName(e.target.value)} />
            <Button type="submit">Create</Button>
          </form>
          {error && <p className={styles.error}>{error}</p>}
        </Card>
      )}

      {bankAccounts.length === 0 ? (
        <EmptyState message="No bank accounts have been added yet." />
      ) : (
        <Card className={styles.card}>
          <div className={styles.list}>
            {bankAccounts.map((account) => (
              <div key={account.id} className={styles.row}>
                <div className={styles.identity}>
                  <span className={styles.name}>{account.name}</span>
                  <span className={styles.meta}>{account.bankName ?? 'No bank name on file'}</span>
                </div>
                <Badge variant={account.isActive ? 'success' : 'neutral'}>{account.isActive ? 'Active' : 'Inactive'}</Badge>
                {canManage && account.isActive && (
                  <Button variant="ghost" onClick={() => deactivateBankAccount.mutate(account.id)}>
                    Deactivate
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <h2 className={styles.title}>Deposit History</h2>
      {deposits.length === 0 ? (
        <EmptyState message="No deposits have been recorded yet." />
      ) : (
        <Card className={styles.card}>
          <div className={styles.list}>
            {deposits.map((deposit) => (
              <div key={deposit.id} className={styles.row}>
                <div className={styles.identity}>
                  <span className={styles.name}>{formatCents(deposit.totalAmount)}</span>
                  <span className={styles.meta}>
                    {deposit.depositDate.slice(0, 10)} · {deposit.includedPaymentRecordIds.length} payment(s)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
