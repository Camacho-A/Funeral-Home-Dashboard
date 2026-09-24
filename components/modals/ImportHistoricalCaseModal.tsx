'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import {
  useExternalFormConfigs,
  usePreviewHistoricalCase,
  useCreateHistoricalCase,
} from '@/hooks/useExternalForms';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatTimestamp } from '@/utils/format';
import styles from './ImportHistoricalCaseModal.module.css';

/**
 * Manors Jotform integration — historical CASE creation (2026-09). An
 * administrative migration action, deliberately separate from the normal
 * "+ New Case" workflow — for the two known real historical Arrangement
 * Forms submissions that predate any Solis case existing at all.
 *
 * INFORMANT vs NEXT OF KIN (authoritative, 2026-09 audit): the Informant
 * section below is reference-only. There is no "use as Next of Kin"
 * button anywhere in this component, deliberately — Next of Kin name and
 * phone are always typed by the staff member, never derived from
 * Informant data.
 *
 * The eventual case number is never predicted or displayed before
 * creation — only after a real case is actually created, from that
 * case's own real, server-assigned caseNumber.
 */
export function ImportHistoricalCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { organizationId } = useOrganization();
  const configsQuery = useExternalFormConfigs(organizationId, open);
  const preview = usePreviewHistoricalCase(organizationId);
  const create = useCreateHistoricalCase(organizationId);

  const [formConfigId, setFormConfigId] = useState('');
  const [submissionId, setSubmissionId] = useState('');
  const [nextOfKinName, setNextOfKinName] = useState('');
  const [nextOfKinPhone, setNextOfKinPhone] = useState('');
  const [result, setResult] = useState<{ alreadyImported: boolean; caseId: string | null; caseNumber: string | null } | null>(null);

  function reset() {
    setFormConfigId('');
    setSubmissionId('');
    setNextOfKinName('');
    setNextOfKinPhone('');
    setResult(null);
    preview.reset();
    create.reset();
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleLookUp() {
    setResult(null);
    await preview.mutateAsync({ formConfigId, externalSubmissionId: submissionId.trim() });
  }

  async function handleCreate() {
    const outcome = await create.mutateAsync({
      formConfigId,
      externalSubmissionId: submissionId.trim(),
      nextOfKinName: nextOfKinName.trim(),
      nextOfKinPhone: nextOfKinPhone.trim(),
    });
    setResult(outcome);
  }

  const previewData = preview.data;
  const canCreate =
    Boolean(previewData?.matchesConfig) &&
    !previewData?.alreadyAssociated &&
    nextOfKinName.trim().length > 0 &&
    nextOfKinPhone.trim().length > 0 &&
    !result;

  return (
    <Modal open={open} onClose={handleClose} title="Import Existing Jotform Case">
      <p className={styles.description}>
        Create a NEW Solis case from a real historical Jotform submission that has no existing Solis case at all —
        for the rare situation where a decedent was never entered into Solis before the Jotform integration went
        live.
      </p>
      <p className={styles.warning}>This will create a NEW Solis case and consume the next normal production case number.</p>

      <label className={styles.label}>
        Form
        <select className={styles.input} value={formConfigId} onChange={(e) => { setFormConfigId(e.target.value); setResult(null); preview.reset(); }}>
          <option value="">Select a form…</option>
          {(configsQuery.data ?? []).map((config) => (
            <option key={config.id} value={config.id}>
              {config.label}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.row}>
        <input
          type="text"
          className={styles.input}
          placeholder="Jotform submission ID"
          value={submissionId}
          onChange={(e) => { setSubmissionId(e.target.value); setResult(null); preview.reset(); }}
          aria-label="Jotform submission ID"
        />
        <Button variant="secondary" onClick={handleLookUp} disabled={!formConfigId || !submissionId.trim() || preview.isPending}>
          Look Up
        </Button>
      </div>

      {preview.isError && <p className={styles.error}>Could not retrieve that submission. Check the ID and try again.</p>}

      {previewData && (
        <>
          {!previewData.matchesConfig && (
            <p className={styles.warningText}>This submission does not belong to the selected form. It cannot be used here.</p>
          )}
          {previewData.alreadyAssociated && (
            <p className={styles.warningText}>
              This submission has already been imported{previewData.existingCaseId ? ' into an existing case' : ''}. It cannot be used to
              create another case.
            </p>
          )}

          {previewData.matchesConfig && !previewData.alreadyAssociated && (
            <>
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Prefilled from Jotform</div>
                <div>Decedent Name: {previewData.decedentName ?? '—'}</div>
                <div>Date of Birth: {previewData.dateOfBirth ?? '—'}</div>
                <div>Date of Death: {previewData.dateOfDeath ?? '—'}</div>
                <div>Place of Death: {previewData.placeOfDeath ?? '—'}</div>
                <div>Submitted: {previewData.submittedAt ? formatTimestamp(previewData.submittedAt) : '—'}</div>
              </div>

              <div className={styles.informantSection}>
                <div className={styles.sectionTitle}>Informant on File — Reference Only</div>
                <div className={styles.referenceOnlyNote}>
                  Informant is not automatically treated as Next of Kin.
                </div>
                <div>Name: {previewData.informantName ?? '—'}</div>
                <div>Relationship: {previewData.informantRelationship ?? '—'}</div>
                <div>Phone: {previewData.informantPhone ?? '—'}</div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>Next of Kin — Required</div>
                <label className={styles.label}>
                  Name
                  <input type="text" className={styles.input} value={nextOfKinName} onChange={(e) => setNextOfKinName(e.target.value)} />
                </label>
                <label className={styles.label}>
                  Phone
                  <input type="text" className={styles.input} value={nextOfKinPhone} onChange={(e) => setNextOfKinPhone(e.target.value)} />
                </label>
              </div>
            </>
          )}
        </>
      )}

      {create.isError && <p className={styles.error}>Case creation failed. Please try again.</p>}

      {result && (
        <p className={styles.success}>
          {result.alreadyImported
            ? 'This submission was already imported previously — no new case was created.'
            : `Case ${result.caseNumber ?? result.caseId} created successfully.`}
        </p>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={handleClose}>
          Close
        </Button>
        <Button onClick={handleCreate} disabled={!canCreate || create.isPending}>
          Create Case
        </Button>
      </div>
    </Modal>
  );
}
