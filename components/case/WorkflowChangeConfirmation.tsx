'use client';

import { Button } from '@/components/ui/Button';
import type { WorkflowChangePreview } from '@/domain/workflow/planCaseWorkflowChange';
import type { ServiceChangeOrderPreview } from '@/services/caseServiceChangeService';
import { formatCentsAsCurrency } from '@/utils/format';
import styles from './WorkflowChangeConfirmation.module.css';

/**
 * Service-specific workflows (2026-10). The in-page confirmation shown
 * before a service-type change moves a case onto another workflow — never
 * a browser confirm(). Lists exactly what the server computed
 * (POST /api/cases/[caseId]/workflow, dry run): completed steps that carry
 * over, completed steps that don't, new requirements (which start
 * unchecked), and the stage the case will land on — called out when it is
 * earlier than today. Nothing changes until "Confirm workflow change";
 * "Go back" changes nothing.
 *
 * Consistent service changes (2026-10): `orderChange`, when given, is what
 * the case order becomes in the same confirmed operation (POST
 * /api/cases/[caseId]/service-change) — workflow and order are applied
 * together or not at all.
 */
export function WorkflowChangeConfirmation({
  preview,
  orderChange,
  isApplying,
  error,
  onConfirm,
  onCancel,
}: {
  preview: WorkflowChangePreview;
  orderChange?: ServiceChangeOrderPreview | null;
  isApplying: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const fromName = preview.from.workflowName ?? 'the current workflow';
  const toName = preview.to.workflowName ?? 'the new workflow';

  return (
    <div className={styles.panel} role="region" aria-label="Confirm workflow change" data-testid="workflow-change-confirmation">
      <p className={styles.lead}>
        Changing the service moves this case from the <strong>{fromName}</strong> workflow to the <strong>{toName}</strong> workflow.
        Nothing has been changed yet.
      </p>

      <p className={preview.movesBackward ? styles.warning : styles.stage} data-testid="workflow-change-stage">
        The case will be at <strong>{preview.to.stageLabel ?? '—'}</strong>
        {preview.from.stageLabel ? <> (currently {preview.from.stageLabel})</> : null}.
        {preview.movesBackward && ' This is an earlier stage than today, because the new workflow still has open steps before it.'}
      </p>

      <Section title={`Completed steps kept (${preview.kept.length})`} empty="None.">
        {preview.kept.map((item) => (
          <li key={`${item.to.displayStage}:${item.to.index}`}>
            {item.to.label} <span className={styles.muted}>— {item.to.stageLabel}</span>
          </li>
        ))}
      </Section>

      <Section title={`Completed steps not carried over (${preview.notCarried.length})`} empty="None — every completed step carries over.">
        {preview.notCarried.map((item) => (
          <li key={`${item.displayStage}:${item.index}`}>
            {item.label} <span className={styles.muted}>— {item.stageLabel}{item.reason === 'value_required' ? ' (its value must be re-entered)' : ' (no matching step in the new workflow)'}</span>
          </li>
        ))}
      </Section>

      <Section title={`New requirements (${preview.newRequirements.length})`} empty="None.">
        {preview.newRequirements.map((item) => (
          <li key={`${item.displayStage}:${item.index}`}>
            {item.label} <span className={styles.muted}>— {item.stageLabel}</span>
          </li>
        ))}
      </Section>

      {orderChange && !orderChange.unchanged && (
        <p className={styles.stage} data-testid="service-change-order">
          The case order is updated in the same step
          {orderChange.currentTotal !== null ? <> — total {formatCentsAsCurrency(orderChange.currentTotal, 'usd')} → </> : <> — new total </>}
          <strong>{formatCentsAsCurrency(orderChange.newTotal, 'usd')}</strong>. The previous order version stays in the billing history.
        </p>
      )}

      <p className={styles.muted}>
        New requirements start unchecked. The previous workflow and its progress are kept in the case&apos;s history, and the change is recorded in Activity.
      </p>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel} disabled={isApplying}>
          Go back
        </Button>
        <Button onClick={onConfirm} disabled={isApplying}>
          {isApplying ? 'Changing…' : 'Confirm workflow change'}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{title}</div>
      {children.length === 0 ? <p className={styles.muted}>{empty}</p> : <ul className={styles.list}>{children}</ul>}
    </div>
  );
}
