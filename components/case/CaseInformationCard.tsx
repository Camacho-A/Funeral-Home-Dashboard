'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { SelectField } from '@/components/ui/SelectField';
import textFieldStyles from '@/components/ui/TextField.module.css';
import type { CaseUpdate, PaymentStatus, VaPublishChoice } from '@/types/case';
import type { VaStepViewModel } from '@/types/caseViewModel';
import { formatDateInput, isValidCalendarDate, normalizeTimeInput } from '@/utils/inputMask';
import { VaNotificationPanel } from './VaNotificationPanel';
import styles from './CaseInformationCard.module.css';

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid_in_full: 'Paid in full',
  awaiting_payment: 'Awaiting payment',
};

export type StaffOption = { id: string; name: string };

/**
 * Click-to-edit primitive for a single Case Information field (Phase 17).
 * Reuses utils/inputMask.ts's date mask/validation exactly as the New Case
 * form does — no second implementation of date formatting or calendar
 * validation. Saving goes through the caller's onSave, which is always a
 * thin wrapper around the *existing* useCaseMutations update path (see
 * CaseDetailPage), so this component has no idea whether it's writing to
 * mock fixtures or Wix — same "reuse the one update mutation" precedent
 * already established by reassignOwner/setVeteranFlag/etc.
 *
 * Behavior: click the value to edit; Enter or blur commits; Escape cancels
 * back to the last saved value. A non-empty invalid date blocks the Enter
 * commit (inline error, stays open) but a blur away from an invalid date
 * simply reverts rather than trapping focus — avoids a bad value ever being
 * saved without needing to fight the browser's own blur order.
 */
function EditableField({
  label,
  value,
  onSave,
  kind = 'text',
  uppercase = false,
}: {
  label: string;
  value: string;
  onSave: (newValue: string) => void;
  kind?: 'text' | 'date' | 'time';
  uppercase?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  // Echoes a just-committed value immediately, rather than the read-only
  // display flickering back to the pre-edit `value` prop for the moment
  // between "save clicked" and "the mutation's response updates the query
  // cache" — cleared once the real value actually catches up to match.
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  useEffect(() => {
    if (pendingValue !== null && value === pendingValue) setPendingValue(null);
  }, [value, pendingValue]);

  const displayValue = pendingValue ?? value;

  function startEditing() {
    setDraft(displayValue);
    setError(null);
    setIsEditing(true);
  }

  function handleChange(raw: string) {
    let next = raw;
    if (kind === 'date') next = formatDateInput(raw);
    else if (uppercase) next = raw.toUpperCase();
    setDraft(next);
    setError(null);
  }

  function commit(valueToCommit: string = draft) {
    setIsEditing(false);
    if (valueToCommit !== displayValue) {
      setPendingValue(valueToCommit);
      onSave(valueToCommit);
    }
  }

  function commitOrRevert() {
    if (kind === 'date' && draft !== '' && !isValidCalendarDate(draft)) {
      setDraft(displayValue);
      setIsEditing(false);
      return;
    }
    if (kind === 'time') {
      // Phase 19.1 (Time Input Normalization): the same shared
      // utils/inputMask.ts#normalizeTimeInput components/modals/NewCaseModal.tsx
      // uses — a blur away from an invalid/ambiguous value reverts (same
      // "don't fight the browser's own blur order" reasoning as 'date'
      // above), but a *valid* one commits its normalized canonical form,
      // not the raw text the user actually typed.
      const normalized = normalizeTimeInput(draft);
      if (normalized === null) {
        setDraft(displayValue);
        setIsEditing(false);
        return;
      }
      commit(normalized);
      return;
    }
    commit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (kind === 'date' && draft !== '' && !isValidCalendarDate(draft)) {
        setError('Enter a valid date (MM/DD/YYYY).');
        return;
      }
      if (kind === 'time') {
        const normalized = normalizeTimeInput(draft);
        if (normalized === null) {
          setError('Enter a valid time (e.g. 2:30 PM or 14:30).');
          return;
        }
        commit(normalized);
        return;
      }
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(displayValue);
      setError(null);
      setIsEditing(false);
    }
  }

  return (
    <div>
      <div className={styles.fieldLabel}>{label}</div>
      {isEditing ? (
        <>
          <input
            autoFocus
            className={textFieldStyles.field}
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={commitOrRevert}
            onKeyDown={handleKeyDown}
            placeholder={kind === 'date' ? 'MM/DD/YYYY' : kind === 'time' ? 'e.g. 2:30 PM' : undefined}
          />
          {error && (
            <div className={styles.fieldError} role="alert">
              {error}
            </div>
          )}
        </>
      ) : (
        <button type="button" className={styles.editableValue} onClick={startEditing}>
          {displayValue || '—'}
        </button>
      )}
    </div>
  );
}

export function CaseInformationCard({
  dateOfBirth,
  dateOfDeath,
  timeOfDeath,
  placeOfDeath,
  weight,
  weightOver200,
  nextOfKinName,
  nextOfKinPhone,
  paymentStatus,
  ownerStaffId,
  staffOptions,
  onReassignOwner,
  onUpdateCaseInfo,
  isVeteran,
  veteranFlagLocked,
  onToggleVeteran,
  vaSteps,
  vaCallbackDone,
  vaPublishChoice,
  onToggleVaStep,
  onSetVaPublishChoice,
}: {
  dateOfBirth: string;
  dateOfDeath: string;
  timeOfDeath: string;
  placeOfDeath: string;
  weight: string;
  weightOver200: boolean;
  nextOfKinName: string;
  nextOfKinPhone: string;
  paymentStatus: PaymentStatus;
  ownerStaffId: string | null;
  staffOptions: StaffOption[];
  onReassignOwner: (staffId: string) => void;
  onUpdateCaseInfo: (patch: CaseUpdate) => void;
  isVeteran: boolean;
  veteranFlagLocked: boolean;
  onToggleVeteran: (newValue: boolean) => void;
  vaSteps: VaStepViewModel[];
  vaCallbackDone: boolean;
  vaPublishChoice: VaPublishChoice | null;
  onToggleVaStep: (index: number, newDone: boolean) => void;
  onSetVaPublishChoice: (choice: VaPublishChoice) => void;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.title}>Case information</div>
      <div className={styles.grid}>
        <EditableField
          label="Date of birth"
          value={dateOfBirth}
          kind="date"
          onSave={(v) => onUpdateCaseInfo({ dateOfBirth: v })}
        />
        <EditableField
          label="Date of death"
          value={dateOfDeath}
          kind="date"
          onSave={(v) => onUpdateCaseInfo({ dateOfDeath: v })}
        />
        <EditableField
          label="Time of death"
          value={timeOfDeath}
          kind="time"
          onSave={(v) => onUpdateCaseInfo({ timeOfDeath: v })}
        />
        <EditableField
          label="Location"
          value={placeOfDeath}
          uppercase
          onSave={(v) => onUpdateCaseInfo({ placeOfDeath: v })}
        />
        <div>
          <div className={styles.fieldLabel}>Weight</div>
          <div className={`${styles.weightValue} ${weightOver200 ? styles.weightOver : styles.weightNormal}`}>
            {weight}
            {weightOver200 && <span className={styles.notifyBadge}>Notify crematory</span>}
          </div>
        </div>
        <EditableField
          label="Next of kin"
          value={nextOfKinName}
          uppercase
          onSave={(v) => onUpdateCaseInfo({ nextOfKinName: v })}
        />
        <EditableField
          label="NOK phone"
          value={nextOfKinPhone}
          onSave={(v) => onUpdateCaseInfo({ nextOfKinPhone: v })}
        />
        <div>
          <div className={styles.fieldLabel}>Payment</div>
          <SelectField
            className={`${styles.paymentSelect} ${paymentStatus === 'paid_in_full' ? styles.paymentSuccess : styles.paymentPending}`}
            value={paymentStatus}
            onChange={(e) => onUpdateCaseInfo({ paymentStatus: e.target.value as PaymentStatus })}
          >
            <option value="awaiting_payment">{PAYMENT_STATUS_LABEL.awaiting_payment}</option>
            <option value="paid_in_full">{PAYMENT_STATUS_LABEL.paid_in_full}</option>
          </SelectField>
        </div>
        <div>
          <div className={styles.fieldLabel}>Owner</div>
          <SelectField
            className={styles.ownerSelect}
            value={ownerStaffId ?? ''}
            onChange={(e) => onReassignOwner(e.target.value)}
          >
            {staffOptions.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      <div
        className={`${styles.veteranRow} ${veteranFlagLocked ? styles.veteranRowLocked : styles.veteranRowUnlocked}`}
        onClick={veteranFlagLocked ? undefined : () => onToggleVeteran(!isVeteran)}
      >
        <Checkbox
          checked={isVeteran}
          disabled={veteranFlagLocked}
          onChange={veteranFlagLocked ? undefined : () => onToggleVeteran(!isVeteran)}
          tone="brand"
          aria-label="Served in the armed forces"
        />
        <span className={styles.veteranLabel}>Served in the armed forces</span>
        {veteranFlagLocked && <span className={styles.veteranLockedNote}>editable during First Call &amp; Payment only</span>}
      </div>

      {isVeteran && (
        <VaNotificationPanel
          vaSteps={vaSteps}
          vaCallbackDone={vaCallbackDone}
          vaPublishChoice={vaPublishChoice}
          onToggleStep={onToggleVaStep}
          onSetPublishChoice={onSetVaPublishChoice}
        />
      )}
    </div>
  );
}
