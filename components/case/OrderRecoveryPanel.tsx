'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { formatCentsAsCurrency, formatTimestamp } from '@/utils/format';
import {
  fetchCaseOrderRecovery,
  repairCaseOrderOperation,
  type RecoverableOrderOperation,
} from '@/lib/orderRecoveryClient';
import type { OrderOperationRepairAction } from '@/services/orderOperationRepair';
import styles from './OrderRecoveryPanel.module.css';

/**
 * Order recovery (2026-11). Shown on the case order ONLY while an
 * interrupted change has locked it (`interruption.stale`). An administrator
 * (admin-tier + caseOrder.update — exactly what the repair API checks) sees
 * which change was interrupted, how the order and ledger stand now, why it
 * needs recovery, and the repairs the server says are safe; each needs an
 * explicit confirmation. Everyone else sees that an administrator must
 * recover it — no report is fetched for them.
 *
 * The server decides everything (services/orderOperationRepair.ts): this
 * panel never changes payments or refunds, and a repair the current state
 * makes unsafe, or that another administrator already ran, is refused.
 */

const ACTION_LABEL: Record<OrderOperationRepairAction, string> = {
  complete: 'Complete the change',
  roll_back: 'Roll back the change',
  close: 'Close (nothing to repair)',
};

const ACTION_EFFECT: Record<OrderOperationRepairAction, string> = {
  complete: 'The interrupted version is put in effect, its missing audit entries and revenue are written once, and the balance is recalculated from the payments on file.',
  roll_back: 'The previous version is put back in effect and the interrupted version is withdrawn (kept in history). No revenue is posted.',
  close: 'Nothing on the order changes. The interrupted change is recorded as closed by you, with your note.',
};

const REVENUE_LABEL: Record<string, string> = {
  posted: 'Posted',
  not_posted: 'Not posted',
  not_needed: 'None needed (no price change)',
  partial: 'Partially written — needs review',
  unknown: 'Could not be read',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'saved, not in effect',
  active: 'in effect',
  superseded: 'replaced',
  withdrawn: 'withdrawn',
  missing: 'never saved',
};

const statusText = (status: string | null) => (status === null ? '—' : STATUS_LABEL[status] ?? status);
const version = (n: number | null | undefined) => (typeof n === 'number' ? `version ${n}` : 'a version');

export function OrderRecoveryPanel({
  organizationId,
  caseId,
  caseName,
  caseNumber,
  canRecover,
}: {
  organizationId: string;
  caseId: string;
  caseName: string;
  caseNumber: string;
  canRecover: boolean;
}) {
  const queryClient = useQueryClient();
  const report = useQuery({
    queryKey: ['caseOrderRecovery', organizationId, caseId],
    queryFn: () => fetchCaseOrderRecovery(organizationId, caseId),
    enabled: canRecover && Boolean(organizationId),
  });

  if (!canRecover) {
    return (
      <div className={styles.panel} role="status">
        <p className={styles.notice}>
          An administrator must recover this order before services can be edited or payments recorded. Nothing has been lost — the
          order shown is the version still billed.
        </p>
      </div>
    );
  }

  return (
    <section className={styles.panel} aria-label="Order recovery">
      <h4 className={styles.title}>Order recovery — administrators</h4>
      <p className={styles.caseLine}>
        Case {caseName} · Case #{caseNumber}
      </p>
      {report.isPending && <p className={styles.notice}>Checking the order and the ledger…</p>}
      {report.isError && (
        <p className={styles.error} role="alert">
          {report.error instanceof Error ? report.error.message : 'The interrupted change could not be loaded.'}
        </p>
      )}
      {report.data && report.data.length === 0 && (
        <p className={styles.notice}>
          No interrupted change is listed for this case yet (a change becomes recoverable 5 minutes after it stopped). Reload in a few
          minutes.
        </p>
      )}
      {report.data?.map((op) => (
        <RecoveryItem
          key={op.operationId}
          op={op}
          organizationId={organizationId}
          onDone={() =>
            Promise.all([
              queryClient.invalidateQueries({ queryKey: ['caseOrderRecovery', organizationId, caseId] }),
              queryClient.invalidateQueries({ queryKey: ['caseOrder', organizationId, caseId] }),
              queryClient.invalidateQueries({ queryKey: ['casePayments', organizationId, caseId] }),
              queryClient.invalidateQueries({ queryKey: ['case', organizationId, caseId] }),
            ])
          }
        />
      ))}
    </section>
  );
}

function RecoveryItem({ op, organizationId, onDone }: { op: RecoverableOrderOperation; organizationId: string; onDone: () => Promise<unknown> }) {
  const [action, setAction] = useState<OrderOperationRepairAction | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inspection = op.inspection;
  const d = op.details;
  const noteRequired = action === 'close';
  const canSubmit = action !== null && confirmed && !busy && (!noteRequired || note.trim().length > 0);

  function choose(next: OrderOperationRepairAction) {
    setAction(next);
    setConfirmed(false);
    setError(null);
  }

  async function submit() {
    if (!action || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await repairCaseOrderOperation(organizationId, op.operationId, action, note.trim());
      setDone(`${ACTION_LABEL[action]}: done. The order has been reloaded.`);
      setAction(null);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The repair could not be completed.');
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.item}>
      <dl className={styles.facts}>
        <dt>Interrupted change</dt>
        <dd>
          {d.kind === 'withdraw' ? 'Withdrawal of' : 'Change from'} {version(d.previousVersion)} to {version(d.plannedVersion)}
          {typeof d.plannedTotal === 'number' ? ` (new total ${formatCentsAsCurrency(d.plannedTotal, 'usd')})` : ''}
        </dd>
        <dt>Started</dt>
        <dd>{formatTimestamp(op.startedAt)}</dd>
        <dt>Last step recorded</dt>
        <dd>
          {op.status} · {formatTimestamp(op.updatedAt)}
        </dd>
        <dt>Change reference</dt>
        <dd className={styles.mono}>{op.operationId}</dd>
        {inspection && (
          <>
            <dt>New version</dt>
            <dd>{statusText(inspection.plannedStatus)}</dd>
            <dt>Previous version</dt>
            <dd>{statusText(inspection.previousStatus)}</dd>
            <dt>Revenue for this change</dt>
            <dd>{REVENUE_LABEL[inspection.revenue] ?? inspection.revenue}</dd>
            <dt>Missing audit entries</dt>
            <dd>{inspection.missingAuditEntries ?? 'could not be read'}</dd>
          </>
        )}
      </dl>
      {inspection && <p className={styles.reason}>Why recovery is needed: {inspection.summary}</p>}
      {done && (
        <p className={styles.done} role="status">
          {done}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {inspection && inspection.allowedActions.length === 0 && (
        <p className={styles.notice}>No repair is safe from SOLIS right now. Follow the manual review steps in the recovery procedure.</p>
      )}
      {inspection && inspection.allowedActions.length > 0 && (
        <div className={styles.actions}>
          {inspection.allowedActions.map((a) => (
            <Button key={a} variant={action === a ? 'primary' : 'secondary'} onClick={() => choose(a)} disabled={busy}>
              {ACTION_LABEL[a]}
            </Button>
          ))}
        </div>
      )}

      {action && (
        <div className={styles.confirm}>
          <p>{ACTION_EFFECT[action]} Payments and refunds are never changed.</p>
          <label className={styles.field}>
            Note {noteRequired ? '(required)' : '(optional)'}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I reviewed this case&rsquo;s order and payments and want to {ACTION_LABEL[action].toLowerCase()}.
          </label>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => setAction(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!canSubmit}>
              {busy ? 'Working…' : `Confirm: ${ACTION_LABEL[action]}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
