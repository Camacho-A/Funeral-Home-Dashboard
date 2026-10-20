'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { isValidPickupReleaseDetail } from '@/domain/cases/pickupRelease';
import { formatDateInput, isValidCalendarDate, expandTwoDigitYearInDateInput } from '@/utils/inputMask';
import type { CaseUpdate } from '@/types/case';
import styles from './ChecklistCard.module.css';

/**
 * Recording the release of the cremated remains (2026-10: the ONE way to
 * do it). Used by the workflow's final step and by Case Information, which
 * previously had its own select-then-fill-in-fields flow that saved each
 * field separately and was hidden for organizations that hide Case Owner.
 */
export type ReleaseSuggestion = { role: string; name: string | null | undefined };

function dedupeSuggestions(suggestions: ReleaseSuggestion[]): { role: string; name: string }[] {
  const seen = new Set<string>();
  const out: { role: string; name: string }[] = [];
  for (const s of suggestions) {
    const name = s.name?.trim();
    if (!name || name === '—') continue;
    const key = name.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role: s.role, name });
  }
  return out;
}

function todayMonthDayYear(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
}

/**
 * Collects the release documentation and sends it with `pickupStatus` in a
 * single patch. Save stays disabled until both required fields are valid
 * per `isValidPickupReleaseDetail` — the same predicate the server-side
 * invariant uses — so the UI cannot produce a request the server would
 * reject, and no partial release is ever persisted.
 */
export function RecordPickupDialog({
  open,
  onClose,
  initialReleasedTo,
  initialReleasedAt,
  initialNote,
  suggestions = [],
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initialReleasedTo: string | null;
  initialReleasedAt: string | null;
  initialNote: string | null;
  /** People already on the case (next of kin, arrangement contact), offered
      as one-click "Released to" names. Blank or duplicate names are dropped. */
  suggestions?: ReleaseSuggestion[];
  onSave: (patch: CaseUpdate) => void;
}) {
  const [releasedTo, setReleasedTo] = useState(initialReleasedTo ?? '');
  const [releasedAt, setReleasedAt] = useState(initialReleasedAt ?? '');
  const [note, setNote] = useState(initialNote ?? '');

  // Re-seed each time the dialog opens so "Correct this record" always
  // starts from what is currently stored rather than a stale draft.
  useEffect(() => {
    if (!open) return;
    setReleasedTo(initialReleasedTo ?? '');
    // A new release is usually recorded the day it happens.
    setReleasedAt(initialReleasedAt ?? todayMonthDayYear());
    setNote(initialNote ?? '');
  }, [open, initialReleasedTo, initialReleasedAt, initialNote]);

  const usableSuggestions = dedupeSuggestions(suggestions);
  const expandedDate = expandTwoDigitYearInDateInput(releasedAt);
  const dateIsFuture = isValidCalendarDate(expandedDate) && expandedDate !== '' && isFutureDate(expandedDate);
  const canSave = isValidPickupReleaseDetail(releasedTo.trim(), expandedDate) && !dateIsFuture;

  return (
    <Modal open={open} onClose={onClose} title="Record family pickup">
      <p className={styles.dialogIntro}>
        This records the release of the cremated remains to the family and completes the final
        workflow step.
      </p>
      <label className={styles.dialogLabel} htmlFor="terminal-released-to">
        Released to
      </label>
      <input
        id="terminal-released-to"
        className={styles.dialogInput}
        value={releasedTo}
        placeholder="Name of the person who collected the remains"
        onChange={(e) => setReleasedTo(e.target.value.toUpperCase())}
      />
      {usableSuggestions.length > 0 && (
        <div className={styles.releaseSuggestions} aria-label="Fill in Released to">
          {usableSuggestions.map((suggestion) => (
            <button
              key={`${suggestion.role}-${suggestion.name}`}
              type="button"
              className={styles.releaseSuggestion}
              onClick={() => setReleasedTo(suggestion.name.toUpperCase())}
            >
              {suggestion.role}: {suggestion.name.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      <label className={styles.dialogLabel} htmlFor="terminal-released-at">
        Released date
      </label>
      <input
        id="terminal-released-at"
        className={styles.dialogInput}
        value={releasedAt}
        placeholder="MM/DD/YYYY"
        inputMode="numeric"
        onChange={(e) => setReleasedAt(formatDateInput(e.target.value))}
      />
      {dateIsFuture && (
        <p className={styles.dialogError} role="alert">
          Released date cannot be in the future.
        </p>
      )}
      <label className={styles.dialogLabel} htmlFor="terminal-note">
        Note (optional)
      </label>
      <input
        id="terminal-note"
        className={styles.dialogInput}
        value={note}
        onChange={(e) => setNote(e.target.value.toUpperCase())}
      />
      <div className={styles.dialogFooter}>
        <button type="button" className={styles.dialogCancel} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.dialogConfirm}
          disabled={!canSave}
          onClick={() =>
            onSave({
              // One patch: the status and the documentation that justifies
              // it can never be persisted apart.
              pickupStatus: 'released',
              pickupReleasedTo: releasedTo.trim(),
              pickupReleasedAt: expandedDate,
              pickupNote: note.trim() === '' ? null : note.trim(),
            })
          }
        >
          Record pickup
        </button>
      </div>
    </Modal>
  );
}

/** Local to this action: a release cannot be dated in the future. Mirrors
    the Released date guard the Case Information card already applies. */
function isFutureDate(mmddyyyy: string): boolean {
  const [month, day, year] = mmddyyyy.split('/').map(Number);
  if (!month || !day || !year) return false;
  const entered = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return entered.getTime() > today.getTime();
}
