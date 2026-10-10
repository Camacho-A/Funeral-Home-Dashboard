'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import styles from './ArchiveCaseSection.module.css';

/**
 * Archived Cases (2026-10). The Archive / Restore control, at the foot of
 * Case Information alongside the other case-level state.
 *
 * ARCHIVING DELETES NOTHING. It sets one boolean, which takes the case out
 * of the working lists and puts it under Archived Cases, where it can be
 * restored with a single click. The case number, checklist state,
 * documents, payments and activity history are all untouched, and both
 * directions are recorded in the case's own activity history. The dialog
 * says so plainly, because "Archive" next to a funeral case can easily
 * read as "delete" to someone who has never used it.
 *
 * Archiving asks for confirmation; restoring does not. The asymmetry
 * matches the consequence — restoring just puts a case back where staff
 * already expect to find it, while archiving makes it disappear from
 * every list they work from.
 */
export function ArchiveCaseSection({
  isArchived,
  caseNumber,
  decedentName,
  onChange,
  pending = false,
  readOnly = false,
}: {
  isArchived: boolean;
  caseNumber: string;
  decedentName: string;
  onChange: (archived: boolean) => void;
  pending?: boolean;
  readOnly?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (isArchived) {
    return (
      <div className={styles.archivedRow}>
        <div>
          <div className={styles.archivedTitle}>This case is archived</div>
          <div className={styles.archivedNote}>
            It is hidden from the working case lists. Nothing has been deleted.
          </div>
        </div>
        {!readOnly && (
          <button type="button" className={styles.restoreButton} disabled={pending} onClick={() => onChange(false)}>
            {pending ? 'Restoring…' : 'Restore case'}
          </button>
        )}
      </div>
    );
  }

  if (readOnly) return null;

  return (
    <>
      <div className={styles.archiveRow}>
        <button type="button" className={styles.archiveButton} disabled={pending} onClick={() => setConfirming(true)}>
          Archive case
        </button>
        <span className={styles.archiveHint}>Hides it from the case lists. Nothing is deleted.</span>
      </div>

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Archive this case?">
        <p className={styles.dialogBody}>
          <strong>{decedentName}</strong> ({caseNumber}) will be hidden from the case lists and moved to{' '}
          <strong>Archived Cases</strong>.
        </p>
        <p className={styles.dialogBody}>
          Nothing is deleted. The case number, checklist, documents, payments and activity history are all kept, and
          you can restore the case at any time. This change is recorded in the case&rsquo;s activity history.
        </p>
        <div className={styles.dialogFooter}>
          <button type="button" className={styles.dialogCancel} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.dialogConfirm}
            disabled={pending}
            onClick={() => {
              setConfirming(false);
              onChange(true);
            }}
          >
            Archive case
          </button>
        </div>
      </Modal>
    </>
  );
}
