'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useRecalculateCaseWorkflow } from '@/hooks/useCaseWorkflowRepair';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import styles from './CaseWorkflowRepairPanel.module.css';

/**
 * Case repair UI (2026-09). Administrator-only "Recalculate Workflow" —
 * a thin UI wrapper around the already-deployed, unmodified
 * `POST /api/cases/[caseId]/recalculate-workflow` (services/
 * workflowReconciliationService.ts#reconcileCaseWorkflow). No new
 * reconciliation logic here; this component only calls the existing
 * endpoint and refreshes Case Detail on success.
 *
 * Self-gated on `user.manageRoles` — the same narrowest-existing-
 * Administrator-only permission already reused for the Case Numbering
 * migration bootstrap control (see CaseNumberingPanel.tsx), rather than a
 * new permission created solely for this. This is a UX nicety, never the
 * security boundary: the underlying route independently re-enforces
 * `case.update` server-side regardless of what this component renders.
 * This is deliberately a repair/admin action, not a normal workflow
 * control — no non-Administrator role ever sees it.
 */
export function CaseWorkflowRepairPanel({ caseId }: { caseId: string }) {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const canSeeRepairAction = Boolean(permissionsQuery.data?.permissions.includes('user.manageRoles'));
  const recalculate = useRecalculateCaseWorkflow(organizationId, caseId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  if (!canSeeRepairAction) return null;

  async function handleConfirm() {
    setConfirmOpen(false);
    try {
      const result = await recalculate.mutateAsync();
      setFeedback({
        message: result.changed ? `Workflow recalculated — case is now correctly positioned.` : 'Workflow recalculated — already correctly positioned, nothing to change.',
        isError: false,
      });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : 'Recalculation failed. Please try again.', isError: true });
    }
  }

  return (
    <div className={styles.panel}>
      <span className={styles.label}>Case stuck or missing prerequisites?</span>
      <Button variant="ghost" disabled={recalculate.isPending} onClick={() => setConfirmOpen(true)}>
        Recalculate Workflow
      </Button>
      {feedback && <div className={feedback.isError ? styles.error : styles.success}>{feedback.message}</div>}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Recalculate Workflow">
        <p>Recalculate this case&apos;s workflow from its current form, payment, and case data?</p>
        <div className={styles.confirmActions}>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={recalculate.isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={recalculate.isPending}>
            {recalculate.isPending ? 'Recalculating…' : 'Recalculate'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
