'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import {
  useBankAccounts,
  useBankReconciliations,
  useStartBankReconciliation,
  useCompleteBankReconciliation,
  useImportBankStatement,
  useStatementImportLines,
  useManuallyMatchStatementLine,
  useExcludeStatementLine,
} from '@/hooks/useAccounting';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './ReconciliationPanel.module.css';

function formatCents(amount: number): string {
  return `$${(amount / 100).toFixed(2)}`;
}

/**
 * Phase 31 (Financial Management & General Ledger). One bank account's
 * reconciliation workspace: import a statement (auto-matched on arrival),
 * manually resolve whatever's left, then start/complete a reconciliation
 * pass. `.reconcile` gates every mutating action here.
 */
export function ReconciliationPanel() {
  const { organizationId } = useOrganization();
  const bankAccountsQuery = useBankAccounts(organizationId);
  const myPermissionsQuery = useMyPermissions(organizationId);

  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [statementEndingBalance, setStatementEndingBalance] = useState('');
  const [statementEndingDate, setStatementEndingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const reconciliationsQuery = useBankReconciliations(organizationId, selectedBankAccountId);
  const statementLinesQuery = useStatementImportLines(organizationId, importId);
  const importStatement = useImportBankStatement(organizationId);
  const matchLine = useManuallyMatchStatementLine(organizationId, importId ?? '');
  const excludeLine = useExcludeStatementLine(organizationId, importId ?? '');
  const startReconciliation = useStartBankReconciliation(organizationId);
  const completeReconciliation = useCompleteBankReconciliation(organizationId, selectedBankAccountId ?? '');

  if (bankAccountsQuery.isPending || myPermissionsQuery.isPending) {
    return <p>Loading reconciliation…</p>;
  }

  const permissions = myPermissionsQuery.data?.permissions ?? [];
  const canView = permissions.includes('accounting.view');
  const canReconcile = permissions.includes('accounting.reconcile');

  if (!canView) {
    return <EmptyState message="You don't have access to reconciliation for this organization." />;
  }

  const bankAccounts = bankAccountsQuery.data ?? [];
  const reconciliations = reconciliationsQuery.data ?? [];
  const statementLines = statementLinesQuery.data ?? [];
  const inProgress = reconciliations.find((r) => r.status === 'in_progress') ?? null;

  // Disclosed limitation: this phase's UI has no CSV/file-upload parser
  // yet (see services/bankingService.ts#importBankStatement's own
  // comment — it accepts already-parsed lines and does no file-format
  // parsing itself). Creates an empty import so the matching workspace
  // below is reachable and testable; a real file picker + parser is a
  // named, deferred follow-up, not something this phase silently skips.
  async function handleImportEmptyStatement() {
    if (!selectedBankAccountId) return;
    setError(null);
    try {
      const result = await importStatement.mutateAsync({
        bankAccountId: selectedBankAccountId,
        fileName: null,
        lines: [],
      });
      setImportId(result.statementImport.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import statement.');
    }
  }

  async function handleStart(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedBankAccountId) return;
    setError(null);
    try {
      await startReconciliation.mutateAsync({
        bankAccountId: selectedBankAccountId,
        statementEndingDate: new Date(statementEndingDate).toISOString(),
        statementEndingBalance: Math.round(Number(statementEndingBalance) * 100),
        bankStatementImportId: importId,
      });
      setStatementEndingBalance('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start reconciliation.');
    }
  }

  return (
    <div>
      <h2 className={styles.title}>Reconciliation</h2>
      <SelectField value={selectedBankAccountId ?? ''} onChange={(e) => setSelectedBankAccountId(e.target.value || null)} className={styles.accountSelect}>
        <option value="">Select a bank account…</option>
        {bankAccounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </SelectField>

      {selectedBankAccountId && (
        <>
          {canReconcile && (
            <Card className={styles.form}>
              <div className={styles.formRow}>
                <Button variant="secondary" onClick={handleImportEmptyStatement} disabled={importStatement.isPending}>
                  Start a new statement import
                </Button>
                {importId && <span className={styles.meta}>Imported — {statementLines.length} line(s)</span>}
              </div>
              {error && <p className={styles.error}>{error}</p>}
            </Card>
          )}

          {statementLines.length > 0 && (
            <Card className={styles.card}>
              <div className={styles.list}>
                {statementLines.map((line) => (
                  <div key={line.id} className={styles.row}>
                    <div className={styles.identity}>
                      <span className={styles.name}>{line.description}</span>
                      <span className={styles.meta}>
                        {line.transactionDate.slice(0, 10)} · {formatCents(line.amount)}
                      </span>
                    </div>
                    <Badge variant={line.matchStatus === 'unmatched' ? 'neutral' : line.matchStatus === 'excluded' ? 'danger' : 'success'}>
                      {line.matchStatus}
                    </Badge>
                    {canReconcile && line.matchStatus === 'unmatched' && (
                      <div className={styles.actions}>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            const journalEntryId = window.prompt('Journal entry id to match this line to:');
                            if (journalEntryId && journalEntryId.trim()) matchLine.mutate({ lineId: line.id, journalEntryId: journalEntryId.trim() });
                          }}
                        >
                          Match
                        </Button>
                        <Button variant="ghost" onClick={() => excludeLine.mutate(line.id)}>
                          Exclude
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <h2 className={styles.title}>History</h2>
          {reconciliations.length === 0 ? (
            <EmptyState message="No reconciliations have been started for this bank account yet." />
          ) : (
            <Card className={styles.card}>
              <div className={styles.list}>
                {reconciliations.map((r) => (
                  <div key={r.id} className={styles.row}>
                    <div className={styles.identity}>
                      <span className={styles.name}>{formatCents(r.statementEndingBalance)}</span>
                      <span className={styles.meta}>Through {r.statementEndingDate.slice(0, 10)}</span>
                    </div>
                    <Badge variant={r.status === 'completed' ? 'success' : 'neutral'}>{r.status}</Badge>
                    {canReconcile && r.status === 'in_progress' && (
                      <Button variant="secondary" onClick={() => completeReconciliation.mutate(r.id)}>
                        Complete
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {canReconcile && !inProgress && (
            <Card className={styles.form}>
              <form onSubmit={handleStart} className={styles.formRow}>
                <TextField type="date" value={statementEndingDate} onChange={(e) => setStatementEndingDate(e.target.value)} required />
                <TextField
                  type="number"
                  step="0.01"
                  placeholder="Statement ending balance"
                  value={statementEndingBalance}
                  onChange={(e) => setStatementEndingBalance(e.target.value)}
                  required
                />
                <Button type="submit">Start reconciliation</Button>
              </form>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
