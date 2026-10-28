'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { useMyPermissions } from '@/hooks/useRbac';
import { correctCaseSsn } from '@/lib/caseSsnClient';
import { CASE_SSN_SOURCE_LABEL, parseSsnCorrectionReason, type CaseSsnSummary } from '@/domain/cases/caseSsn';
import { normalizeSsn } from '@/domain/documents/manateeDeathCertificateApplication';
import styles from './CaseInformationCard.module.css';

/**
 * Case SSN in Case Information (2026-10). Read-only for everyone: the last
 * four digits, where they came from, and a lock. It is saved from the
 * case's Arrangement Form (else Vital Statistics form) — no staff edit.
 * An administrator can correct it, with a reason recorded in the case
 * activity. The full number is never shown.
 */
export function CaseSsnField({
  organizationId,
  caseId,
  ssnOnFile,
  readOnly,
}: {
  organizationId: string;
  caseId: string;
  ssnOnFile: CaseSsnSummary | null | undefined;
  readOnly: boolean;
}) {
  const permissions = useMyPermissions(organizationId);
  const isAdministrator = permissions.isSuccess && permissions.data.permissions.includes('organization.manage');
  const [correcting, setCorrecting] = useState(false);

  return (
    <div>
      <div className={styles.fieldLabel}>Social Security number</div>
      {ssnOnFile ? (
        <div className={styles.fieldValue}>
          •••-••-{ssnOnFile.last4} <span className="sx-status" title="Locked — corrections by an administrator only">Locked</span>
          <div className={styles.fieldLabel}>{CASE_SSN_SOURCE_LABEL[ssnOnFile.source]}</div>
        </div>
      ) : (
        <div className={styles.fieldValue}>
          <span className={styles.fieldLabel}>Not on file — saved from the Arrangement Form when it arrives</span>
        </div>
      )}
      {isAdministrator && !readOnly && (
        <button type="button" className={styles.editNameButton} onClick={() => setCorrecting(true)}>
          {ssnOnFile ? 'Correct…' : 'Enter…'}
        </button>
      )}
      {correcting && <CorrectSsnDialog organizationId={organizationId} caseId={caseId} hasSsn={Boolean(ssnOnFile)} onClose={() => setCorrecting(false)} />}
    </div>
  );
}

function CorrectSsnDialog({ organizationId, caseId, hasSsn, onClose }: { organizationId: string; caseId: string; hasSsn: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [ssn, setSsn] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ssnValid = Boolean(normalizeSsn(ssn));
  const reasonCheck = parseSsnCorrectionReason(reason);
  const canSave = ssnValid && typeof reasonCheck === 'string' && !pending;

  async function save() {
    setPending(true);
    setError(null);
    try {
      await correctCaseSsn({ organizationId, caseId, ssn, reason });
      await queryClient.invalidateQueries({ queryKey: ['case', organizationId, caseId] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The Social Security number could not be saved.');
    } finally {
      setPending(false);
    }
  }

  const title = hasSsn ? 'Correct Social Security number' : 'Enter Social Security number';
  return (
    <Modal open onClose={onClose} title={title}>
      <p className={styles.sectionHelperText}>
        The number is saved encrypted and locked. Staff see only its last four digits. Your reason is recorded in the case activity; the number
        is not.
      </p>
      <div className="sx-field">
        <label className="sx-label sx-label-required" htmlFor="case-ssn-correction">
          Social Security number
        </label>
        <input
          id="case-ssn-correction"
          className="sx-input"
          autoComplete="off"
          inputMode="numeric"
          placeholder="###-##-####"
          value={ssn}
          aria-invalid={ssn.trim() !== '' && !ssnValid ? true : undefined}
          onChange={(e) => setSsn(e.target.value)}
        />
        {ssn.trim() !== '' && !ssnValid && <span className="sx-help">A Social Security number has 9 digits.</span>}
      </div>
      <div className="sx-field">
        <label className="sx-label sx-label-required" htmlFor="case-ssn-reason">
          Reason
        </label>
        <input
          id="case-ssn-reason"
          className="sx-input"
          placeholder="e.g. Arrangement Form had a typo; confirmed with the family"
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
        {reason.trim() !== '' && typeof reasonCheck !== 'string' && <span className="sx-help">{reasonCheck.error}</span>}
      </div>
      {error && (
        <div className="sx-form-banner sx-form-banner-error" role="alert">
          {error}
        </div>
      )}
      <div className="sx-modal-footer">
        <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button type="button" className="sx-btn sx-btn-primary" onClick={save} disabled={!canSave}>
          {pending ? 'Saving…' : 'Save and lock'}
        </button>
      </div>
    </Modal>
  );
}
