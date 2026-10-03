'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import {
  useJournalEntries,
  useChartOfAccounts,
  useCreateManualJournalEntry,
  usePostJournalEntry,
  useVoidJournalEntry,
  useReverseJournalEntry,
} from '@/hooks/useAccounting';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './JournalEntriesPanel.module.css';

type DraftLine = { accountId: string; direction: 'debit' | 'credit'; amount: string };

/**
 * Phase 31 (Financial Management & General Ledger). Journal Entries —
 * lists every entry, supports composing a new `manual` draft with its
 * lines inline, and posting/voiding/reversing an existing one. `.manage`
 * gates composing a draft; `.post` gates post/void/reverse — the same
 * tier split ADR-035 documents (mirrors `schedule.edit`/`schedule.cancel`).
 */
export function JournalEntriesPanel() {
  const { organizationId } = useOrganization();
  const entriesQuery = useJournalEntries(organizationId);
  const accountsQuery = useChartOfAccounts(organizationId);
  const myPermissionsQuery = useMyPermissions(organizationId);
  const createEntry = useCreateManualJournalEntry(organizationId);
  const postEntry = usePostJournalEntry(organizationId);
  const voidEntry = useVoidJournalEntry(organizationId);
  const reverseEntry = useReverseJournalEntry(organizationId);

  const [formOpen, setFormOpen] = useState(false);
  const [memo, setMemo] = useState('');
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<DraftLine[]>([
    { accountId: '', direction: 'debit', amount: '' },
    { accountId: '', direction: 'credit', amount: '' },
  ]);
  const [error, setError] = useState<string | null>(null);

  if (entriesQuery.isPending || accountsQuery.isPending || myPermissionsQuery.isPending) {
    return <p>Loading journal entries…</p>;
  }

  const permissions = myPermissionsQuery.data?.permissions ?? [];
  const canView = permissions.includes('accounting.view');
  const canManage = permissions.includes('accounting.manage');
  const canPost = permissions.includes('accounting.post');

  if (!canView) {
    return <EmptyState message="You don't have access to journal entries for this organization." />;
  }

  const entries = [...(entriesQuery.data ?? [])].sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1));
  const accounts = accountsQuery.data ?? [];

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createEntry.mutateAsync({
        entryDate: new Date(entryDate).toISOString(),
        memo,
        lines: lines.map((l) => ({ accountId: l.accountId, direction: l.direction, amount: Math.round(Number(l.amount) * 100) })),
      });
      setMemo('');
      setLines([
        { accountId: '', direction: 'debit', amount: '' },
        { accountId: '', direction: 'credit', amount: '' },
      ]);
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create journal entry.');
    }
  }

  return (
    <div>
      <div className={styles.toolbar}>
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Journal Entries</h2>
        <div className={styles.spacer} />
        {canManage && (
          <button type="button" className={formOpen ? 'sx-btn sx-btn-secondary' : 'sx-btn sx-btn-primary'} onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? 'Cancel' : '+ New Manual Entry'}
          </button>
        )}
      </div>

      {formOpen && canManage && (
        <div style={{ border: '1px solid var(--sx-border)', borderRadius: 10, padding: '16px 18px', marginBottom: 24 }}>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(0,1fr)', gap: 14, marginBottom: 12 }}>
              <TextField className="sx-input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
              <TextField className="sx-input" placeholder="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 140px 160px 32px', gap: 8, fontSize: 12, color: 'var(--sx-muted)', marginBottom: 6 }}>
              <span>Account</span>
              <span>Direction</span>
              <span>Amount</span>
              <span />
            </div>
            {lines.map((line, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 140px 160px 32px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <SelectField className="sx-select" value={line.accountId} onChange={(e) => updateLine(i, { accountId: e.target.value })} required>
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountNumber} — {a.name}
                    </option>
                  ))}
                </SelectField>
                <SelectField className="sx-select" value={line.direction} onChange={(e) => updateLine(i, { direction: e.target.value as 'debit' | 'credit' })}>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </SelectField>
                <TextField
                  className="sx-input"
                  type="number"
                  step="0.01"
                  placeholder="Amount"
                  value={line.amount}
                  onChange={(e) => updateLine(i, { amount: e.target.value })}
                  required
                  style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => setLines((prev) => [...prev, { accountId: '', direction: 'debit', amount: '' }])}>
                + Add line
              </button>
              <button type="submit" className="sx-btn sx-btn-primary">
                Save draft
              </button>
            </div>
          </form>
          {error && <p className="sx-error">{error}</p>}
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState message="No journal entries have been posted yet." />
      ) : (
        <table className="sx-table sx-table-stack">
          <thead>
            <tr>
              <th>Entry</th>
              <th>Date</th>
              <th>Memo</th>
              <th>Source</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td data-label="Entry" style={{ fontSize: 12.5, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {entry.entryNumber}
                </td>
                <td data-label="Date" className="sx-mono">
                  {entry.entryDate.slice(0, 10)}
                </td>
                <td data-label="Memo" data-primary>
                  {entry.memo}
                </td>
                <td data-label="Source">{entry.sourceType}</td>
                <td data-label="Status">
                  <span className={entry.status === 'posted' ? 'sx-status sx-status-ok' : 'sx-status'}>{entry.status}</span>
                </td>
                <td>
                  {canPost && entry.status === 'draft' && (
                    <div className="sx-row-actions">
                      <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={() => postEntry.mutate(entry.id)}>
                        Post
                      </button>
                      <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => voidEntry.mutate(entry.id)}>
                        Void
                      </button>
                    </div>
                  )}
                  {canPost && entry.status === 'posted' && (
                    <div className="sx-row-actions">
                      <button
                        type="button"
                        className="sx-btn sx-btn-ghost sx-btn-sm"
                        onClick={() => {
                          const reason = window.prompt('Reason for reversing this entry:');
                          if (reason && reason.trim()) reverseEntry.mutate({ entryId: entry.id, reason: reason.trim() });
                        }}
                      >
                        Reverse
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
