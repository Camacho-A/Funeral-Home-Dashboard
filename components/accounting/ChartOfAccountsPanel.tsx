'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useChartOfAccounts, useCreateLedgerAccount, useDeactivateLedgerAccount } from '@/hooks/useAccounting';
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
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Chart of Accounts</h2>
        <div className={styles.spacer} />
        {canManage && (
          <button type="button" className={formOpen ? 'sx-btn sx-btn-secondary' : 'sx-btn sx-btn-primary'} onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? 'Cancel' : '+ New Account'}
          </button>
        )}
      </div>

      {formOpen && canManage && (
        <div style={{ border: '1px solid var(--sx-border)', borderRadius: 10, padding: '16px 18px', marginBottom: 24 }}>
          <form onSubmit={handleCreate} className="sx-form-grid sx-form-grid-3">
            <div className="sx-field">
              <TextField className="sx-input" placeholder="Account number (e.g. 1300)" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required />
            </div>
            <div className="sx-field">
              <TextField className="sx-input" placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="sx-field">
              <SelectField className="sx-select" value={accountType} onChange={(e) => setAccountType(e.target.value as LedgerAccountType)}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="sx-field">
              <SelectField className="sx-select" value={normalBalance} onChange={(e) => setNormalBalance(e.target.value as LedgerAccountNormalBalance)}>
                <option value="debit">Debit-normal</option>
                <option value="credit">Credit-normal</option>
              </SelectField>
            </div>
            <button type="submit" className="sx-btn sx-btn-primary">
              Create
            </button>
          </form>
          {error && <p className="sx-error">{error}</p>}
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyState message="No accounts have been created yet." />
      ) : (
        <table className="sx-table sx-table-stack">
          <thead>
            <tr>
              <th>Number</th>
              <th>Account</th>
              <th>Type</th>
              <th>Normal balance</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td data-label="Number" className="sx-mono">
                  {account.accountNumber}
                </td>
                <td data-label="Account" data-primary className="sx-cell-title">
                  {account.name}
                </td>
                <td data-label="Type">{account.accountType}</td>
                <td data-label="Normal balance">{account.normalBalance === 'debit' ? 'Debit' : 'Credit'}</td>
                <td data-label="Status">
                  <span className={account.isActive ? 'sx-status sx-status-ok' : 'sx-status'}>{account.isActive ? 'Active' : 'Inactive'}</span>
                  {account.isSystemAccount && <span className="sx-tag" style={{ marginLeft: 6 }}>System</span>}
                </td>
                <td>
                  {canManage && account.isActive && !account.isSystemAccount && (
                    <div className="sx-row-actions">
                      <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => deactivateAccount.mutate(account.id)}>
                        Deactivate
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
