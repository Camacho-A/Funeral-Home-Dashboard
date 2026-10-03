'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyPermissions } from '@/hooks/useRbac';
import { useManorsCutoverEligibility, useExecuteManorsCutover } from '@/hooks/useCaseNumbering';
import { useManorsCaseNumberManageMigrationStatus, useExecuteManorsCaseNumberManageMigration } from '@/hooks/useManorsRbacMigration';
import { formatCaseNumber } from '@/domain/cases/caseNumber';
import { Modal } from '@/components/ui/Modal';

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
 *
 * SOLIS Tasks/Calendar/Settings phase, §3.5 (design S4): restyled to the
 * sx- form/settings-section system. Renders as `{children}` inside
 * `SettingsShell` — no own page-level `<h1>`.
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
    return <p className="sx-help">Loading case numbering…</p>;
  }

  // Neither the normal permission nor the bootstrap permission — nothing
  // in this panel applies to this caller (e.g. Manager/Office Staff/
  // Accounting/Read Only/Dispatch reaching this page by direct URL, not
  // through the nav link). No protected data is fetched or shown; the
  // underlying APIs still independently 403 regardless of this message.
  if (!canManageCaseNumber && !canSeeMigrationAction) {
    return <div className="sx-empty"><div className="sx-empty-title">You don&apos;t have access to Case Numbering.</div></div>;
  }

  const migrationData = migrationStatusQuery.data;
  const showMigrationAction = canSeeMigrationAction && migrationData?.applicable && migrationData?.needsMigration;

  return (
    <div>
      {showMigrationAction && (
        <section className="sx-settings-section">
          <h3 className="sx-settings-section-title">Enable Case Numbering Access</h3>
          <p className="sx-help">
            Grants Case Numbering access to Administrator and Funeral Director for Manors Cremations.
          </p>
          <button type="button" className="sx-btn sx-btn-primary" onClick={() => setMigrationConfirmOpen(true)}>
            Enable Case Numbering Access
          </button>
          {migration.isError && <div className="sx-error-state" role="alert" style={{ marginTop: 8 }}>{(migration.error as Error).message}</div>}
        </section>
      )}

      <Modal open={migrationConfirmOpen} onClose={() => setMigrationConfirmOpen(false)} title="Enable Case Numbering Access">
        <p className="sx-help">
          Grants Case Numbering access to Administrator and Funeral Director for Manors Cremations. This does not
          change any other permission and does not affect any other role.
        </p>
        <div className="sx-modal-footer" style={{ padding: 0, border: 'none', height: 'auto', marginTop: 16 }}>
          <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setMigrationConfirmOpen(false)} disabled={migration.isPending}>
            Cancel
          </button>
          <button type="button" className="sx-btn sx-btn-primary" onClick={handleMigrationConfirm} disabled={migration.isPending}>
            {migration.isPending ? 'Enabling…' : 'Confirm'}
          </button>
        </div>
      </Modal>

      {!canManageCaseNumber && (
        <p className="sx-help">Case Numbering access must be enabled before this section is available.</p>
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
    return <p className="sx-help">Loading case numbering…</p>;
  }
  if (eligibilityQuery.isError) {
    return <div className="sx-error-state" role="alert">{(eligibilityQuery.error as Error).message}</div>;
  }

  const data = eligibilityQuery.data;
  if (!data) return null;

  const currentCaseNumber = data.currentNextSequence !== null ? formatCaseNumber(data.year, data.currentNextSequence) : null;

  return (
    <>
      <section className="sx-settings-section">
        <h3 className="sx-settings-section-title">{data.year} Case Numbering</h3>
        <div style={{ display: 'inline-block', border: '1px solid var(--sx-border)', borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ fontSize: 12.5, color: 'var(--sx-muted)' }}>Next Case Number:</div>
          <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--sx-text)' }}>{currentCaseNumber ?? '—'}</div>
        </div>
      </section>

      {result && (
        <p className="sx-help" style={{ color: 'var(--sx-green-text)' }}>
          Case numbering is ready. The next new SOLIS case will be {formatCaseNumber(data.year, result.nextSequence)}.
        </p>
      )}

      {!result && data.eligible && (
        <section className="sx-settings-section">
          <h3 className="sx-settings-section-title">Prepare SOLIS Case Numbering</h3>
          <p className="sx-help">
            Manors cases {data.historicalCaseNumbers.join(' and ')} already exist outside SOLIS and will be imported
            separately. This will make {data.firstNormalCaseNumber} the next case number assigned to a new SOLIS case.
          </p>
          <button type="button" className="sx-btn sx-btn-primary" onClick={() => setConfirmOpen(true)}>
            Prepare SOLIS Case Numbering
          </button>
        </section>
      )}

      {!result && !data.eligible && data.reason && <p className="sx-help">{data.reason}</p>}

      {cutover.isError && <div className="sx-error-state" role="alert">{(cutover.error as Error).message}</div>}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Prepare SOLIS Case Numbering">
        <dl className="sx-kv">
          <dt>Current next new-case number:</dt>
          <dd>{currentCaseNumber}</dd>
          <dt>After cutover:</dt>
          <dd>{data.firstNormalCaseNumber}</dd>
          <dt>Historical numbers preserved for import:</dt>
          <dd>{data.historicalCaseNumbers.join(', ')}</dd>
        </dl>
        <p className="sx-help" style={{ marginTop: 12 }}>
          This does not create either historical case. It only changes the next number SOLIS will assign to a newly
          created case.
        </p>
        <div className="sx-modal-footer" style={{ padding: 0, border: 'none', height: 'auto', marginTop: 16 }}>
          <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setConfirmOpen(false)} disabled={cutover.isPending}>
            Cancel
          </button>
          <button type="button" className="sx-btn sx-btn-primary" onClick={handleConfirm} disabled={cutover.isPending}>
            {cutover.isPending ? 'Preparing…' : 'Confirm'}
          </button>
        </div>
      </Modal>
    </>
  );
}
