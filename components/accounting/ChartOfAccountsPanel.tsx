'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useChartOfAccounts, useCreateLedgerAccount, useDeactivateLedgerAccount } from '@/hooks/useAccounting';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';
import type { LedgerAccountType, LedgerAccountNormalBalance } from '@/types/ledgerAccount';
import styles from './ChartOfAccountsPanel.module.css';

const ACCOUNT_TYPES: LedgerAccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

/**
 * Phase 31 (Financial Management & General Ledger). Chart of Accounts —
 * gates read on `accounting.view`, create/deactivate on `accounting.manage`,
 * mirroring `DocumentTemplateLibraryPanel.tsx`'s exact permission-gating
 * shape (the established pattern for every settings-adjacent panel).
 */
export function ChartOfAccountsPanel() {
  const { organizationId } = useOrganization();
  const accountsQuery = useChartOfAccounts(organizationId);
  const myPermissionsQuery = useMyPermissions(organizationId);
  const createAccount = useCreateLedgerAccount(organizationId);
  const deactivateAccount = useDeactivateLedgerAccount(organizationId);

  const [formOpen, setFormOpen] = useState(false);
  const [accountNumber, setAccountNumber] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<LedgerAccountType>('asset');
  const [normalBalance, setNormalBalance] = useState<LedgerAccountNormalBalance>('debit');
  const [error, setError] = useState<string | null>(null);

  if (accountsQuery.isPending || myPermissionsQuery.isPending) {
    return <p>Loading chart of accounts…</p>;
  }

  const permissions = myPermissionsQuery.data?.permissions ?? [];
  const canView = permissions.includes('accounting.view');
  const canManage = permissions.includes('accounting.manage');

  if (!canView) {
    return <EmptyState message="You don't have access to the chart of accounts for this organization." />;
  }

  const accounts = [...(accountsQuery.data ?? [])].sort((a, b) => (a.accountNumber < b.accountNumber ? -1 : 1));

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createAccount.mutateAsync({ accountNumber, name, accountType, normalBalance });
      setAccountNumber('');
      setName('');
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account.');
    }
  }

  return (
    <div>
      <div className={styles.toolbar}>
        <h2 className={styles.title}>Chart of Accounts</h2>
        <div className={styles.spacer} />
        {canManage && <Button onClick={() => setFormOpen((v) => !v)}>{formOpen ? 'Cancel' : '+ New Account'}</Button>}
      </div>

      {formOpen && canManage && (
        <Card className={styles.form}>
          <form onSubmit={handleCreate} className={styles.formGrid}>
            <TextField placeholder="Account number (e.g. 1300)" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required />
            <TextField placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} required />
            <SelectField value={accountType} onChange={(e) => setAccountType(e.target.value as LedgerAccountType)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </SelectField>
            <SelectField value={normalBalance} onChange={(e) => setNormalBalance(e.target.value as LedgerAccountNormalBalance)}>
              <option value="debit">Debit-normal</option>
              <option value="credit">Credit-normal</option>
            </SelectField>
            <Button type="submit">Create</Button>
          </form>
          {error && <p className={styles.error}>{error}</p>}
        </Card>
      )}

      {accounts.length === 0 ? (
        <EmptyState message="No accounts have been created yet." />
      ) : (
        <Card className={styles.card}>
          <div className={styles.list}>
            {accounts.map((account) => (
              <div key={account.id} className={styles.row}>
                <span className={styles.number}>{account.accountNumber}</span>
                <div className={styles.identity}>
                  <span className={styles.name}>{account.name}</span>
                  <span className={styles.meta}>
                    {account.accountType} · {account.normalBalance}-normal
                  </span>
                </div>
                <Badge variant={account.isActive ? 'success' : 'neutral'}>{account.isActive ? 'Active' : 'Inactive'}</Badge>
                {account.isSystemAccount && <Badge variant="brand">System</Badge>}
                {canManage && account.isActive && !account.isSystemAccount && (
                  <Button variant="ghost" onClick={() => deactivateAccount.mutate(account.id)}>
                    Deactivate
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
