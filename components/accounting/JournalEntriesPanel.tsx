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
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';
import type { JournalEntryStatus } from '@/types/journalEntry';
import styles from './JournalEntriesPanel.module.css';

const STATUS_VARIANT: Record<JournalEntryStatus, 'neutral' | 'brand' | 'success' | 'danger'> = {
  draft: 'neutral',
  posted: 'success',
  void: 'danger',
};

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
        <h2 className={styles.title}>Journal Entries</h2>
        <div className={styles.spacer} />
        {canManage && <Button onClick={() => setFormOpen((v) => !v)}>{formOpen ? 'Cancel' : '+ New Manual Entry'}</Button>}
      </div>

      {formOpen && canManage && (
        <Card className={styles.form}>
          <form onSubmit={handleCreate}>
            <div className={styles.formRow}>
              <TextField type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
              <TextField placeholder="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} required className={styles.memoField} />
            </div>
            {lines.map((line, i) => (
              <div key={i} className={styles.formRow}>
                <SelectField value={line.accountId} onChange={(e) => updateLine(i, { accountId: e.target.value })} required>
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountNumber} — {a.name}
                    </option>
                  ))}
                </SelectField>
                <SelectField value={line.direction} onChange={(e) => updateLine(i, { direction: e.target.value as 'debit' | 'credit' })}>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </SelectField>
                <TextField type="number" step="0.01" placeholder="Amount" value={line.amount} onChange={(e) => updateLine(i, { amount: e.target.value })} required />
              </div>
            ))}
            <div className={styles.formRow}>
              <Button type="button" variant="secondary" onClick={() => setLines((prev) => [...prev, { accountId: '', direction: 'debit', amount: '' }])}>
                + Add line
              </Button>
              <Button type="submit">Save draft</Button>
            </div>
          </form>
          {error && <p className={styles.error}>{error}</p>}
        </Card>
      )}

      {entries.length === 0 ? (
        <EmptyState message="No journal entries have been posted yet." />
      ) : (
        <Card className={styles.card}>
          <div className={styles.list}>
            {entries.map((entry) => (
              <div key={entry.id} className={styles.row}>
                <span className={styles.number}>{entry.entryNumber}</span>
                <div className={styles.identity}>
                  <span className={styles.name}>{entry.memo}</span>
                  <span className={styles.meta}>
                    {entry.entryDate.slice(0, 10)} · {entry.sourceType}
                  </span>
                </div>
                <Badge variant={STATUS_VARIANT[entry.status]}>{entry.status}</Badge>
                {canPost && entry.status === 'draft' && (
                  <div className={styles.actions}>
                    <Button variant="secondary" onClick={() => postEntry.mutate(entry.id)}>
                      Post
                    </Button>
                    <Button variant="ghost" onClick={() => voidEntry.mutate(entry.id)}>
                      Void
                    </Button>
                  </div>
                )}
                {canPost && entry.status === 'posted' && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const reason = window.prompt('Reason for reversing this entry:');
                      if (reason && reason.trim()) reverseEntry.mutate({ entryId: entry.id, reason: reason.trim() });
                    }}
                  >
                    Reverse
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
