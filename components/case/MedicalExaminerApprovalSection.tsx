'use client';

import { useState } from 'react';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import type { MedicalExaminerApprovalView } from '@/services/medicalExaminerApprovalService';
import styles from './ServiceReadinessCard.module.css';

/**
 * Medical examiner cremation approval (Gus Phase 5G, 2026-11). Staff record
 * the approval they confirmed in EDRS: date, EDRS/ME reference, and what it
 * rests on (a document on the case and/or where it was verified). SOLIS
 * never infers it from the permit, EDRS ticks or the ME jurisdiction flag.
 * A correction needs a reason; every recording stays in the history.
 */
export function MedicalExaminerApprovalSection({
  view,
  documents,
  canEdit,
  isSaving,
  error,
  onRecord,
  formatWhen,
}: {
  view: MedicalExaminerApprovalView;
  documents: { id: string; fileName: string }[];
  canEdit: boolean;
  isSaving: boolean;
  error: string | null;
  onRecord: (input: { confirmedInEdrs: boolean; approvalDate: string; reference: string; evidenceDocumentId: string | null; evidenceSource: string | null; reason: string | null }, done: () => void) => void;
  formatWhen: (iso: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [approvalDate, setApprovalDate] = useState('');
  const [reference, setReference] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const current = view.approval;
  const linked = documents.find((d) => d.id === current?.evidence.documentId);

  return (
    <div className={styles.meApproval} data-testid="me-approval">
      <div className={styles.sectionLabel}>Medical examiner cremation approval</div>
      {current ? (
        <p className={styles.meRecorded}>
          Confirmed in EDRS — approved {current.approvalDate}, ref. {current.reference}
          <span className={styles.itemHint}>
            Evidence: {[linked?.fileName, current.evidence.source].filter(Boolean).join(' · ')} — recorded by {current.recordedByName ?? 'staff'}, {formatWhen(current.recordedAt)}
          </span>
        </p>
      ) : (
        <p className={styles.note}>Not recorded. Confirm the approval in EDRS, then record it here. The permit or the EDRS steps alone do not count.</p>
      )}
      {view.history.length > 1 && <p className={styles.itemHint}>{view.history.length} recordings in this case’s history (corrections included).</p>}

      {canEdit && !open && (
        <button type="button" className={styles.smallButton} onClick={() => setOpen(true)}>
          {current ? 'Correct the approval' : 'Record the approval'}
        </button>
      )}
      {canEdit && open && (
        <form
          className={styles.meForm}
          onSubmit={(e) => {
            e.preventDefault();
            onRecord(
              { confirmedInEdrs: confirmed, approvalDate, reference, evidenceDocumentId: documentId || null, evidenceSource: source || null, reason: current ? reason : null },
              () => setOpen(false),
            );
          }}
        >
          <label className={styles.checkLine}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I saw the medical examiner’s cremation approval in EDRS
          </label>
          <label className={styles.detail}>
            <span>Approval date</span>
            <TextField type="date" value={approvalDate} onChange={(e) => setApprovalDate(e.target.value)} required />
          </label>
          <label className={styles.detail}>
            <span>EDRS or medical examiner reference</span>
            <TextField value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} required />
          </label>
          <label className={styles.detail}>
            <span>Supporting document on the case</span>
            <SelectField value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">{documents.length ? 'None' : 'No documents on this case yet'}</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fileName}
                </option>
              ))}
            </SelectField>
          </label>
          <label className={styles.detail}>
            <span>Where it was verified (if no document)</span>
            <TextField value={source} maxLength={200} onChange={(e) => setSource(e.target.value)} placeholder="e.g. EDRS case status screen" />
          </label>
          {current && (
            <label className={styles.detail}>
              <span>Reason for the correction</span>
              <TextField value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} required />
            </label>
          )}
          {error && (
            <p className="sx-form-banner sx-form-banner-error" role="alert">
              {error}
            </p>
          )}
          <span className={styles.controls}>
            <button type="submit" className={styles.smallButton} disabled={isSaving || !confirmed}>
              {isSaving ? 'Saving…' : 'Save approval'}
            </button>
            <button type="button" className={styles.linkButton} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </span>
        </form>
      )}
    </div>
  );
}
