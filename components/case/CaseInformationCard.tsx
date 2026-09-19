'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { SelectField } from '@/components/ui/SelectField';
import textFieldStyles from '@/components/ui/TextField.module.css';
import type { CaseUpdate, NextOfKinRelationship, PaymentStatus, PickupStatus, VaPublishChoice } from '@/types/case';
import type { VaStepViewModel } from '@/types/caseViewModel';
import { formatDateInput, isValidCalendarDate, normalizeTimeInput, isValidEmail } from '@/utils/inputMask';
import { VaNotificationPanel } from './VaNotificationPanel';
import styles from './CaseInformationCard.module.css';

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid_in_full: 'Paid in full',
  awaiting_payment: 'Awaiting payment',
};

const PICKUP_STATUS_LABEL: Record<PickupStatus, string> = {
  awaiting_pickup: 'Awaiting pickup',
  released: 'Released to family',
};

/** Manors launch-prep. Display labels for the NOK-relationship dropdown —
    same small closed-enum convention as PICKUP_STATUS_LABEL above. */
const NEXT_OF_KIN_RELATIONSHIP_LABEL: Record<NextOfKinRelationship, string> = {
  spouse: 'Spouse',
  domestic_partner: 'Domestic Partner',
  son: 'Son',
  daughter: 'Daughter',
  parent: 'Parent',
  brother: 'Brother',
  sister: 'Sister',
  grandchild: 'Grandchild',
  grandparent: 'Grandparent',
  niece: 'Niece',
  nephew: 'Nephew',
  other_relative: 'Other Relative',
  friend: 'Friend',
  legal_representative: 'Legal Representative',
  other: 'Other',
};
const NEXT_OF_KIN_RELATIONSHIP_OPTIONS = Object.entries(NEXT_OF_KIN_RELATIONSHIP_LABEL) as [NextOfKinRelationship, string][];

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
  kind?: 'text' | 'date' | 'time' | 'email';
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
    if (kind === 'email') {
      // Manors launch-prep: trim before validating/committing — surrounding
      // whitespace never blocks a valid address or ends up persisted. A
      // blur away from an invalid (non-empty) address reverts, same
      // "don't fight the browser's own blur order" reasoning as 'date'.
      const trimmed = draft.trim();
      if (trimmed !== '' && !isValidEmail(trimmed)) {
        setDraft(displayValue);
        setIsEditing(false);
        return;
      }
      commit(trimmed);
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
      if (kind === 'email') {
        const trimmed = draft.trim();
        if (trimmed !== '' && !isValidEmail(trimmed)) {
          setError('Enter a valid email address.');
          return;
        }
        commit(trimmed);
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
            type={kind === 'email' ? 'email' : 'text'}
            className={textFieldStyles.field}
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={commitOrRevert}
            onKeyDown={handleKeyDown}
            placeholder={kind === 'date' ? 'MM/DD/YYYY' : kind === 'time' ? 'e.g. 2:30 PM' : kind === 'email' ? 'name@example.com' : undefined}
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
  nextOfKinEmail,
  nextOfKinRelationship,
  nextOfKinRelationshipOther,
  tagNumber,
  paymentStatus,
  pickupStatus,
  pickupReleasedTo,
  pickupReleasedAt,
  pickupNote,
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
  /** Manors launch-prep. Optional — null until staff enter one. Capture
      only; never triggers any communication on its own. */
  nextOfKinEmail: string | null;
  /** Manors launch-prep. Optional — unset until staff know it. */
  nextOfKinRelationship: NextOfKinRelationship | null;
  /** Only meaningful when nextOfKinRelationship === 'other'. */
  nextOfKinRelationshipOther: string | null;
  /** Manors launch-prep. Operational chain-of-custody tag — null until
      staff assign one. */
  tagNumber: string | null;
  paymentStatus: PaymentStatus;
  /** Manors launch-prep. Structured pickup/release tracking — see
      types/case.ts's own comment on why this exists separately from the
      free-text case log. */
  pickupStatus: PickupStatus;
  pickupReleasedTo: string | null;
  pickupReleasedAt: string | null;
  pickupNote: string | null;
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
        <EditableField
          label="NOK email"
          value={nextOfKinEmail ?? ''}
          kind="email"
          onSave={(v) => onUpdateCaseInfo({ nextOfKinEmail: v.trim().length > 0 ? v.trim() : null })}
        />
        <div>
          <div className={styles.fieldLabel}>NOK relationship</div>
          <SelectField
            value={nextOfKinRelationship ?? ''}
            onChange={(e) =>
              onUpdateCaseInfo({
                nextOfKinRelationship: e.target.value ? (e.target.value as NextOfKinRelationship) : null,
              })
            }
          >
            <option value="">—</option>
            {NEXT_OF_KIN_RELATIONSHIP_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
        {nextOfKinRelationship === 'other' && (
          <EditableField
            label="Relationship (describe)"
            value={nextOfKinRelationshipOther ?? ''}
            onSave={(v) => onUpdateCaseInfo({ nextOfKinRelationshipOther: v.trim().length > 0 ? v.trim() : null })}
          />
        )}
        <EditableField
          label="Tag #"
          value={tagNumber ?? ''}
          uppercase
          onSave={(v) => onUpdateCaseInfo({ tagNumber: v.trim().length > 0 ? v.trim() : null })}
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

      <div className={styles.grid}>
        <div>
          <div className={styles.fieldLabel}>Pickup status</div>
          <SelectField
            className={`${styles.paymentSelect} ${pickupStatus === 'released' ? styles.paymentSuccess : styles.paymentPending}`}
            value={pickupStatus}
            onChange={(e) => onUpdateCaseInfo({ pickupStatus: e.target.value as PickupStatus })}
          >
            <option value="awaiting_pickup">{PICKUP_STATUS_LABEL.awaiting_pickup}</option>
            <option value="released">{PICKUP_STATUS_LABEL.released}</option>
          </SelectField>
        </div>
        {pickupStatus === 'released' && (
          <>
            <EditableField
              label="Released to"
              value={pickupReleasedTo ?? ''}
              uppercase
              onSave={(v) => onUpdateCaseInfo({ pickupReleasedTo: v.trim().length > 0 ? v.trim() : null })}
            />
            <EditableField
              label="Released date"
              value={pickupReleasedAt ?? ''}
              kind="date"
              onSave={(v) => onUpdateCaseInfo({ pickupReleasedAt: v.trim().length > 0 ? v.trim() : null })}
            />
            <EditableField
              label="Pickup note (optional)"
              value={pickupNote ?? ''}
              onSave={(v) => onUpdateCaseInfo({ pickupNote: v.trim().length > 0 ? v.trim() : null })}
            />
          </>
        )}
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
