'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useManorsCutoverEligibility, useExecuteManorsCutover } from '@/hooks/useCaseNumbering';
import { useManorsCaseNumberManageMigrationStatus, useExecuteManorsCaseNumberManageMigration } from '@/hooks/useManorsRbacMigration';
import { formatCaseNumber } from '@/domain/cases/caseNumber';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import styles from './CaseNumberingPanel.module.css';

/**
 * Manors go-live case-number cutover (2026-09). "Settings > Case
 * Numbering." Read-only display of the current 2026 sequence state, plus
 * — for the Manors organization only, and only while the sequence is
 * still at its pre-cutover value — a one-time, confirmation-gated action
 * that establishes the next normal SOLIS-allocated case number. See
 * app/api/organization/case-sequence/manors-go-live-cutover/route.ts's
 * own doc comment for the full design and why this is a separate route
 * from the general-purpose case-sequence mechanism.
 *
 * Authorization is enforced entirely server-side (`caseNumber.manage` for
 * normal content, `user.manageRoles` for the migration control below) —
 * hiding either section here is a UX nicety, never the security boundary;
 * every underlying API independently re-checks and fails closed.
 *
 * RBAC bootstrap fix (2026-09): the Administrator-only "Enable Case
 * Numbering Access" migration control (`user.manageRoles`) is rendered
 * from a state that is INDEPENDENT of `eligibilityQuery` (the normal
 * `caseNumber.manage`-gated content below) — deliberately, since before
 * the migration runs, `caseNumber.manage` doesn't exist live yet and
 * `eligibilityQuery` 403s. An earlier version of this component
 * early-returned on that 403 before ever reaching the migration control,
 * which meant Administrator had no way to reach the very control that
 * fixes the underlying gap. See TopBar.tsx's matching nav-link fix.
 */
export function CaseNumberingPanel() {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const canManageCaseNumber = Boolean(permissionsQuery.data?.permissions.includes('caseNumber.manage'));
  const canSeeMigrationAction = Boolean(permissionsQuery.data?.permissions.includes('user.manageRoles'));

  const eligibilityQuery = useManorsCutoverEligibility(organizationId);
  const cutover = useExecuteManorsCutover(organizationId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<{ nextSequence: number } | null>(null);

  const migrationStatusQuery = useManorsCaseNumberManageMigrationStatus(canSeeMigrationAction ? organizationId : '');
  const migration = useExecuteManorsCaseNumberManageMigration(organizationId);
  const [migrationConfirmOpen, setMigrationConfirmOpen] = useState(false);

  async function handleConfirm() {
    const outcome = await cutover.mutateAsync();
    setResult({ nextSequence: outcome.nextSequence });
    setConfirmOpen(false);
  }

  async function handleMigrationConfirm() {
    await migration.mutateAsync();
    setMigrationConfirmOpen(false);
  }

  if (permissionsQuery.isPending) {
    return <p>Loading case numbering…</p>;
  }

  // Neither the normal permission nor the bootstrap permission — nothing
  // in this panel applies to this caller (e.g. Manager/Office Staff/
  // Accounting/Read Only/Dispatch reaching this page by direct URL, not
  // through the nav link). No protected data is fetched or shown; the
  // underlying APIs still independently 403 regardless of this message.
  if (!canManageCaseNumber && !canSeeMigrationAction) {
    return <p className={styles.description}>You don&apos;t have access to Case Numbering.</p>;
  }

  const migrationData = migrationStatusQuery.data;
  const showMigrationAction = canSeeMigrationAction && migrationData?.applicable && migrationData?.needsMigration;

  return (
    <div>
      {showMigrationAction && (
        <div className={styles.cutoverBox}>
          <div className={styles.sectionTitle}>Enable Case Numbering Access</div>
          <p className={styles.description}>
            Grants Case Numbering access to Administrator and Funeral Director for Manors Cremations.
          </p>
          <Button onClick={() => setMigrationConfirmOpen(true)}>Enable Case Numbering Access</Button>
          {migration.isError && <p className={styles.error}>{(migration.error as Error).message}</p>}
        </div>
      )}

      <Modal open={migrationConfirmOpen} onClose={() => setMigrationConfirmOpen(false)} title="Enable Case Numbering Access">
        <p className={styles.description}>
          Grants Case Numbering access to Administrator and Funeral Director for Manors Cremations. This does not
          change any other permission and does not affect any other role.
        </p>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={() => setMigrationConfirmOpen(false)} disabled={migration.isPending}>
            Cancel
          </Button>
          <Button onClick={handleMigrationConfirm} disabled={migration.isPending}>
            {migration.isPending ? 'Enabling…' : 'Confirm'}
          </Button>
        </div>
      </Modal>

      {!canManageCaseNumber && (
        <p className={styles.description}>Case Numbering access must be enabled before this section is available.</p>
      )}

      {canManageCaseNumber && <NormalCaseNumberingContent eligibilityQuery={eligibilityQuery} cutover={cutover} result={result} confirmOpen={confirmOpen} setConfirmOpen={setConfirmOpen} handleConfirm={handleConfirm} />}
    </div>
  );
}

/** The pre-existing "current sequence + one-time cutover" content,
    factored out so its own loading/error/data states never affect
    whether the migration control above renders — it is only ever mounted
    once the caller is confirmed to hold `caseNumber.manage`. */
function NormalCaseNumberingContent({
  eligibilityQuery,
  cutover,
  result,
  confirmOpen,
  setConfirmOpen,
  handleConfirm,
}: {
  eligibilityQuery: ReturnType<typeof useManorsCutoverEligibility>;
  cutover: ReturnType<typeof useExecuteManorsCutover>;
  result: { nextSequence: number } | null;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  handleConfirm: () => Promise<void>;
}) {
  if (eligibilityQuery.isPending) {
    return <p>Loading case numbering…</p>;
  }
  if (eligibilityQuery.isError) {
    return <p className={styles.error}>{(eligibilityQuery.error as Error).message}</p>;
  }

  const data = eligibilityQuery.data;
  if (!data) return null;

  const currentCaseNumber = data.currentNextSequence !== null ? formatCaseNumber(data.year, data.currentNextSequence) : null;

  return (
    <>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{data.year} Case Numbering</div>
        <div className={styles.currentNumber}>Next Case Number: {currentCaseNumber ?? '—'}</div>
      </div>

      {result && (
        <p className={styles.success}>
          Case numbering is ready. The next new SOLIS case will be {formatCaseNumber(data.year, result.nextSequence)}.
        </p>
      )}

      {!result && data.eligible && (
        <div className={styles.cutoverBox}>
          <div className={styles.sectionTitle}>Prepare SOLIS Case Numbering</div>
          <p className={styles.description}>
            Manors cases {data.historicalCaseNumbers.join(' and ')} already exist outside SOLIS and will be imported
            separately. This will make {data.firstNormalCaseNumber} the next case number assigned to a new SOLIS case.
          </p>
          <Button onClick={() => setConfirmOpen(true)}>Prepare SOLIS Case Numbering</Button>
        </div>
      )}

      {!result && !data.eligible && data.reason && <p className={styles.description}>{data.reason}</p>}

      {cutover.isError && <p className={styles.error}>{(cutover.error as Error).message}</p>}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Prepare SOLIS Case Numbering">
        <div className={styles.summaryRow}>
          <span>Current next new-case number:</span>
          <strong>{currentCaseNumber}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>After cutover:</span>
          <strong>{data.firstNormalCaseNumber}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Historical numbers preserved for import:</span>
          <strong>{data.historicalCaseNumbers.join(', ')}</strong>
        </div>
        <p className={styles.description}>
          This does not create either historical case. It only changes the next number SOLIS will assign to a newly
          created case.
        </p>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={cutover.isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={cutover.isPending}>
            {cutover.isPending ? 'Preparing…' : 'Confirm'}
          </Button>
        </div>
      </Modal>
    </>
  );
}
