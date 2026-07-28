'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import styles from './ConfirmActionDialog.module.css';

/**
 * Phase 23 (Team Management). A generic confirm/cancel dialog, reused for
 * every irreversible-feeling Team page action (disable, remove, revoke) —
 * one component rather than three near-identical ones, matching this
 * codebase's "reuse existing patterns" preference. `onConfirm` may throw
 * (e.g. the last-administrator invariant, surfaced as `RoleServiceError`
 * from the server) — the thrown message is shown inline rather than
 * silently closing the dialog, so the caller understands why the action
 * didn't happen.
 */
export function ConfirmActionDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className={styles.body}>
        <p className={styles.message}>{message}</p>
        {error && <span className={styles.error}>{error}</span>}
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={handleConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
