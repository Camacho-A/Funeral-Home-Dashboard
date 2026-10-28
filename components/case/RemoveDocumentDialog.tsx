'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/TextArea';
import {
  DOCUMENT_REMOVAL_REASONS,
  parseDocumentRemoval,
  type DocumentRemoval,
  type DocumentRemovalReason,
} from '@/domain/organization/documentArchiveCapability';
import confirmStyles from '@/components/settings/ConfirmActionDialog.module.css';
import styles from './RemoveDocumentDialog.module.css';

/**
 * 2026-10. An administrator removes a document uploaded by mistake — a
 * duplicate, or the wrong file. The document leaves the current list and
 * stays in the case's history ("Superseded & archived"); nothing is
 * deleted. The reason is recorded on the case activity.
 */
export function RemoveDocumentDialog({
  fileName,
  onClose,
  onConfirm,
}: {
  fileName: string;
  onClose: () => void;
  onConfirm: (removal: DocumentRemoval) => Promise<void>;
}) {
  const [reason, setReason] = useState<DocumentRemovalReason | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseDocumentRemoval({ reason, note });
  const ready = !('error' in parsed);

  async function handleConfirm() {
    if ('error' in parsed) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(parsed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Remove Document">
      <div className={confirmStyles.body}>
        <p className={confirmStyles.message}>
          &ldquo;{fileName}&rdquo; will be removed from this case&rsquo;s documents. It is kept in the case history and is not
          deleted.
        </p>
        <fieldset className={styles.reasons}>
          <legend className={styles.legend}>Why is it being removed?</legend>
          {(Object.keys(DOCUMENT_REMOVAL_REASONS) as DocumentRemovalReason[]).map((key) => (
            <label key={key} className={styles.reason}>
              <input type="radio" name="document-removal-reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
              {DOCUMENT_REMOVAL_REASONS[key]}
            </label>
          ))}
        </fieldset>
        <label className={styles.legend} htmlFor="document-removal-note">
          {reason === 'other' ? 'Details' : 'Note (optional)'}
        </label>
        <TextArea id="document-removal-note" className={styles.note} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <span className={confirmStyles.error}>{error}</span>}
        <div className={confirmStyles.actions}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={handleConfirm} disabled={pending || !ready}>
            {pending ? 'Removing…' : 'Remove'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
