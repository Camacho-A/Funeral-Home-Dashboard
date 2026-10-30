'use client';

import { createContext, useContext, useEffect, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { Checkbox as BaseCheckbox } from '@/components/ui/Checkbox';
import { SelectField as BaseSelectField } from '@/components/ui/SelectField';
import textFieldStyles from '@/components/ui/TextField.module.css';
import { formatPhoneNumber } from '@/domain/contact/phoneNumber';
import type { CaseUpdate, NextOfKinRelationship, PaymentStatus, PickupStatus, ReturnMethod, ShippingDeliveryStatus, VaPublishChoice, VaNotificationResponsibility } from '@/types/case';
import type { VaStepViewModel } from '@/types/caseViewModel';
import {
  formatDateInput,
  formatMilitaryTimeInput,
  isValidCalendarDate,
  isValidMilitaryTime,
  isValidEmail,
  expandTwoDigitYearInDateInput,
  getDateOfBirthDeathOrderError,
  getDateOfDeathFutureError,
  getDateOfBirthFutureError,
  getFutureDateError,
  getCremationBeforeDeathError,
  splitMilitaryTimeToTwelveHourParts,
  combineTwelveHourTimeParts,
  formatMilitaryTimeToTwelveHour,
} from '@/utils/inputMask';
import { VaNotificationPanel } from './VaNotificationPanel';
import { NEXT_OF_KIN_RELATIONSHIP_OPTIONS } from '@/domain/cases/nextOfKinRelationship';
import { normalizeNextOfKinName } from '@/domain/cases/nextOfKinName';
import { ContactInstructionsSection } from './ContactInstructionsSection';
import { ArchiveCaseSection } from './ArchiveCaseSection';
import { Modal } from '@/components/ui/Modal';
import { PENDING_MEDICAL_EXAMINER_LABEL } from '@/domain/organization/medicalExaminerWorkflow';
import { composeDecedentName } from '@/domain/cases/decedentName';
import { toDisplayName } from '@/utils/displayName';
import { RecordPickupDialog, type ReleaseSuggestion } from './RecordPickupDialog';
import type { CasePaymentSummary } from '@/domain/cases/casePaymentSummary';
import styles from './CaseInformationCard.module.css';

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid_in_full: 'Paid in full',
  awaiting_payment: 'Awaiting payment',
};

/** Staff-facing terminology (2026-09) — presentation only. The persisted
    enum values (`'awaiting_pickup'`/`'released'`) and every technical
    identifier (pickupStatus, pickupReleasedTo/At/Note, pickup.read/.update,
    PickupOnlyCaseView, PICKUP_ONLY_PATCH_FIELDS) are unchanged; only these
    display strings and the field-group label below ("Cremated Remains")
    changed. */
const PICKUP_STATUS_LABEL: Record<PickupStatus, string> = {
  awaiting_pickup: 'Awaiting Family Pickup',
  released: 'Family Picked Up',
};

/** Conditional shipping/tracking (2026-09). 'undecided' is the honest
    default for a new case — never silently rendered as if Pickup had been
    chosen. See types/case.ts's ReturnMethod comment. */
const RETURN_METHOD_LABEL: Record<ReturnMethod, string> = {
  undecided: 'Undecided',
  pickup: 'Pickup',
  shipping: 'Shipping',
};

const SHIPPING_DELIVERY_STATUS_LABEL: Record<ShippingDeliveryStatus, string> = {
  shipped: 'Shipped',
  delivered: 'Delivered',
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
/**
 * Read-only mode (2026-10), used for archived cases.
 *
 * A context rather than a prop threaded through two dozen fields: this
 * card renders ~25 click-to-edit values and several selects, and a prop
 * per field is exactly the kind of list where one gets missed and quietly
 * stays editable. One provider at the top covers every control inside,
 * including any added later.
 *
 * Presentation only. The server refuses writes to an archived case
 * regardless (domain/cases/archivedCaseWrites.ts); this is so staff are
 * never offered a control that would fail.
 */
const ReadOnlyContext = createContext(false);

function useIsReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

/**
 * Read-only-aware wrappers, shadowing the imported primitives under their
 * own names so every existing call site inside this file is covered
 * without each one remembering to pass `disabled`. New controls added
 * later are covered automatically for the same reason.
 */
function SelectField(props: ComponentProps<typeof BaseSelectField>) {
  const readOnly = useIsReadOnly();
  return <BaseSelectField {...props} disabled={readOnly || props.disabled} />;
}

function Checkbox(props: ComponentProps<typeof BaseCheckbox>) {
  const readOnly = useIsReadOnly();
  return <BaseCheckbox {...props} disabled={readOnly || props.disabled} />;
}

function EditableField({
  label,
  value,
  onSave,
  kind = 'text',
  uppercase = false,
  crossFieldValidate,
  valueClassName,
  trailingBadge,
  emptyLabel,
  missing,
  required = false,
  clear,
}: {
  label: string;
  value: string;
  onSave: (newValue: string) => void;
  /** `'phone'` formats the DISPLAYED value only (see presentedValue
      below) — editing, typing, and pasting all work on the raw stored
      string, so no keystroke is ever fought and no digit rewritten. */
  kind?: 'text' | 'date' | 'time' | 'email' | 'phone';
  uppercase?: boolean;
  /** Solis go-live checkpoint. 'date'-kind only — a relative-to-another-
      field check (DOB/DOD ordering, DOD-not-in-the-future) that a single
      field's own format validity can't express. Called with the value
      already expanded to a 4-digit year. */
  crossFieldValidate?: (value: string) => string | null;
  /** Case field editing (2026-09). Extra class appended to the displayed
      (non-editing) value button — e.g. Weight's bold/over-limit color —
      without a second, bespoke click-to-edit implementation. */
  valueClassName?: string;
  /** Case field editing (2026-09). Inline content rendered next to the
      displayed value only (never shown while editing) — e.g. Weight's
      "Notify crematory" badge. */
  trailingBadge?: ReactNode;
  /** What an empty value reads as instead of "—". Used for Medical
      Examiner cases, where a blank means "the ME has not released this
      yet", not "nobody filled it in". Display only — the stored value is
      untouched and nothing is back-filled. */
  emptyLabel?: string;
  /** Tag Number at the top of Case Information (2026-10). How an EMPTY
      value reads when its absence needs noticing: a subtle amber prompt
      that is itself the way to start editing (`prompt`), or, read-only,
      the plain statement (`readOnlyText`). Display only. */
  missing?: { prompt: string; readOnlyText: string };
  /** Date of Cremation (2026-10): clearing the box reverts instead of
      erasing a recorded value — a date can be corrected here, never
      blanked by accident. */
  required?: boolean;
  /** Date of Cremation (2026-10): the one way to remove a recorded value —
      a "Clear" action beside it that asks for confirmation first. Never
      offered on a read-only (archived) card or while the field is empty. */
  clear?: { confirmText: string; onConfirm: () => void };
}) {
  const readOnly = useIsReadOnly();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  // Echoes a just-committed value immediately, rather than the read-only
  // display flickering back to the pre-edit `value` prop for the moment
  // between "save clicked" and "the mutation's response updates the query
  // cache" — cleared once the real value actually catches up to match.
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    if (pendingValue !== null && value === pendingValue) setPendingValue(null);
  }, [value, pendingValue]);

  const displayValue = pendingValue ?? value;
  /**
   * What staff READ. Editing still works on `displayValue`, the raw
   * stored string — a phone field that reformatted mid-edit would fight
   * the person typing it, and reformatting on save would rewrite stored
   * data this change deliberately leaves alone.
   */
  const presentedValue = kind === 'phone' ? formatPhoneNumber(displayValue) : displayValue;

  function startEditing() {
    setConfirmingClear(false);
    setDraft(displayValue);
    setError(null);
    setIsEditing(true);
  }

  function handleChange(raw: string) {
    let next = raw;
    if (kind === 'date') next = formatDateInput(raw);
    else if (kind === 'time') next = formatMilitaryTimeInput(raw);
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
    if (kind === 'date') {
      // Solis go-live checkpoint: expand a fully-typed two-digit year
      // before validating/committing — see
      // utils/inputMask.ts#expandTwoDigitYearInDateInput's own comment.
      const expanded = expandTwoDigitYearInDateInput(draft);
      if ((expanded === '' && required) || (expanded !== '' && (!isValidCalendarDate(expanded) || crossFieldValidate?.(expanded)))) {
        setDraft(displayValue);
        setIsEditing(false);
        return;
      }
      commit(expanded);
      return;
    }
    if (kind === 'time') {
      // Solis go-live checkpoint: handleChange already keeps `draft` in
      // live-masked "HH:MM" form (utils/inputMask.ts#formatMilitaryTimeInput),
      // so there's no separate normalization step — just the same
      // "invalid non-empty value reverts on blur" reasoning as 'date' above.
      if (draft !== '' && !isValidMilitaryTime(draft)) {
        setDraft(displayValue);
        setIsEditing(false);
        return;
      }
      commit();
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
      if (kind === 'date') {
        const expanded = expandTwoDigitYearInDateInput(draft);
        // An emptied required box is not a request to erase the value:
        // put it back, exactly as leaving the box does.
        if (expanded === '' && required) {
          setDraft(displayValue);
          setError(null);
          setIsEditing(false);
          return;
        }
        if (expanded !== '' && !isValidCalendarDate(expanded)) {
          setError('Enter a valid date (MM/DD/YYYY).');
          return;
        }
        const crossFieldError = expanded !== '' ? (crossFieldValidate?.(expanded) ?? null) : null;
        if (crossFieldError) {
          setError(crossFieldError);
          return;
        }
        commit(expanded);
        return;
      }
      if (kind === 'time') {
        if (draft !== '' && !isValidMilitaryTime(draft)) {
          setError('Enter a valid time (HH:MM, 24-hour).');
          return;
        }
        commit();
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
            placeholder={kind === 'date' ? 'MM/DD/YYYY' : kind === 'time' ? 'HH:MM' : kind === 'email' ? 'name@example.com' : undefined}
          />
          {error && (
            <div className={styles.fieldError} role="alert">
              {error}
            </div>
          )}
        </>
      ) : (
        <div className={styles.editableValueRow}>
          {missing && !presentedValue ? (
            readOnly ? (
              <span className={`${styles.readOnlyValue} ${styles.missingValue}`}>{missing.readOnlyText}</span>
            ) : (
              <button type="button" className={`${styles.editableValue} ${styles.missingValue}`} onClick={startEditing}>
                {missing.prompt}
              </button>
            )
          ) : readOnly ? (
            <span className={`${styles.readOnlyValue} ${valueClassName ?? ''}`}>
              {presentedValue || emptyLabel || '—'}
            </span>
          ) : (
            <button
              type="button"
              className={`${styles.editableValue} ${trailingBadge ? styles.editableValueCompact : ''} ${valueClassName ?? ''}`}
              onClick={startEditing}
            >
              {presentedValue || emptyLabel || '—'}
            </button>
          )}
          {trailingBadge}
          {clear && !readOnly && presentedValue && !confirmingClear && (
            <button type="button" className={styles.clearValueButton} aria-label={`Clear ${label}`} onClick={() => setConfirmingClear(true)}>
              Clear
            </button>
          )}
        </div>
      )}
      {clear && !readOnly && confirmingClear && !isEditing && (
        <div className={styles.clearConfirm} role="group" aria-label={`Confirm clearing ${label}`}>
          <span>{clear.confirmText}</span>
          <span className={styles.clearConfirmActions}>
            <button
              type="button"
              className={styles.clearConfirmButton}
              onClick={() => {
                setConfirmingClear(false);
                setPendingValue('');
                clear.onConfirm();
              }}
            >
              Clear date
            </button>
            <button type="button" className={styles.editNameButton} onClick={() => setConfirmingClear(false)}>
              Cancel
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

/**
 * Time of Death 12-hour entry (2026-09). A separate, purpose-built
 * click-to-edit field rather than a new EditableField `kind` — the
 * canonical persisted value is still strict 24-hour "HH:mm" (unchanged;
 * isValidMilitaryTime still governs it end to end), but staff enter/see it
 * as three plain, closed-option controls (hour 1-12, minute 00-59, AM/PM),
 * which structurally can never produce an invalid or "guessed" time the
 * way free-text entry could. No blur-based commit here — there's no
 * single element to blur from across three <select>s — so committing is
 * an explicit Save action instead, matching this component's own
 * documented "explicit save if the component already supports it"
 * convention. combineTwelveHourTimeParts (utils/inputMask.ts) does the
 * actual 12-hour -> 24-hour normalization; this component only collects
 * the three parts and displays the friendly 12-hour form when idle.
 *
 * Mirrors EditableField's own pendingValue echo-until-confirmed
 * mechanism so a just-saved time doesn't flicker back to the pre-edit
 * value while the mutation is still in flight.
 */
function TwelveHourTimeField({
  label,
  value,
  onSave,
  emptyLabel,
}: {
  label: string;
  value: string;
  onSave: (newValue: string) => void;
  /** See EditableField's own `emptyLabel`. */
  emptyLabel?: string;
}) {
  const readOnly = useIsReadOnly();
  const [isEditing, setIsEditing] = useState(false);
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('');
  const [period, setPeriod] = useState<'' | 'AM' | 'PM'>('');
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  useEffect(() => {
    if (pendingValue !== null && value === pendingValue) setPendingValue(null);
  }, [value, pendingValue]);

  const displayValue = pendingValue ?? value;

  function startEditing() {
    const parts = splitMilitaryTimeToTwelveHourParts(displayValue);
    setHour(parts.hour);
    setMinute(parts.minute);
    setPeriod(parts.period);
    setIsEditing(true);
  }

  function commit() {
    const normalized = combineTwelveHourTimeParts(hour, minute, period);
    setIsEditing(false);
    if (normalized !== null && normalized !== displayValue) {
      setPendingValue(normalized);
      onSave(normalized);
    }
  }

  function cancel() {
    setIsEditing(false);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  return (
    <div>
      <div className={styles.fieldLabel}>{label}</div>
      {isEditing ? (
        <div className={styles.timeEditRow} onKeyDown={handleKeyDown}>
          <SelectField aria-label="Hour" value={hour} onChange={(e) => setHour(e.target.value)}>
            <option value="">--</option>
            {HOUR_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </SelectField>
          <span className={styles.timeColon}>:</span>
          <SelectField aria-label="Minute" value={minute} onChange={(e) => setMinute(e.target.value)}>
            <option value="">--</option>
            {MINUTE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectField>
          <SelectField aria-label="AM or PM" value={period} onChange={(e) => setPeriod(e.target.value as '' | 'AM' | 'PM')}>
            <option value="">--</option>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </SelectField>
          <button type="button" className={styles.timeSaveButton} onClick={commit} aria-label="Save time of death">
            Save
          </button>
          <button type="button" className={styles.timeCancelButton} onClick={cancel} aria-label="Cancel editing time of death">
            Cancel
          </button>
        </div>
      ) : readOnly ? (
        <span className={styles.readOnlyValue}>
          {formatMilitaryTimeToTwelveHour(displayValue) || emptyLabel || '—'}
        </span>
      ) : (
        <button type="button" className={styles.editableValue} onClick={startEditing}>
          {formatMilitaryTimeToTwelveHour(displayValue) || emptyLabel || '—'}
        </button>
      )}
    </div>
  );
}

/**
 * Edit Name (2026-10). A small dialog for correcting the deceased's name,
 * opened from beside the name itself.
 *
 * TWO FIELDS, DELIBERATELY: the name as recorded, and the middle name.
 * Not first/middle/last — SOLIS has never stored a split name, and
 * splitting an existing one means guessing where a multi-word surname
 * begins ("EVARISTA SILVA RIVERO"). So the stored name is edited as the
 * single string it is, and the middle name stays the separate value it
 * already is. Nothing is parsed or re-derived from what is typed.
 *
 * The preview shows exactly how the two will read together, through the
 * same `composeDecedentName` every other surface uses — so what staff
 * approve here is what the case will show everywhere.
 */
function EditNameDialog({
  open,
  decedentName,
  decedentMiddleName,
  onCancel,
  onSave,
}: {
  open: boolean;
  decedentName: string;
  decedentMiddleName: string | null;
  onCancel: () => void;
  onSave: (next: { decedentName: string; decedentMiddleName: string | null }) => void;
}) {
  const [name, setName] = useState(decedentName);
  const [middle, setMiddle] = useState(decedentMiddleName ?? '');

  // Reopening after an edit elsewhere must show the current values, not
  // whatever was typed the previous time.
  useEffect(() => {
    if (open) {
      setName(decedentName);
      setMiddle(decedentMiddleName ?? '');
    }
  }, [open, decedentName, decedentMiddleName]);

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0;

  return (
    <Modal open={open} onClose={onCancel} title="Edit name">
      <div className={styles.editNameBody}>
        <label className={styles.editNameField}>
          <span className={styles.fieldLabel}>Name as recorded</span>
          <input
            className={textFieldStyles.field}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value.toUpperCase())}
          />
          <span className={styles.editNameHint}>
            First and last name, including a multi-word surname. Edited as one value — SOLIS never splits it.
          </span>
        </label>

        <label className={styles.editNameField}>
          <span className={styles.fieldLabel}>Middle name</span>
          <input
            className={textFieldStyles.field}
            value={middle}
            onChange={(e) => setMiddle(e.target.value.toUpperCase())}
          />
          <span className={styles.editNameHint}>Optional. Leave blank if there is none.</span>
        </label>

        <div className={styles.editNamePreview}>
          <span className={styles.fieldLabel}>Will display as</span>
          <strong>{toDisplayName(composeDecedentName(trimmedName, middle)) || '—'}</strong>
        </div>
      </div>

      <div className={styles.editNameFooter}>
        <button type="button" className={styles.editNameCancel} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.editNameSave}
          disabled={!canSave}
          onClick={() =>
            onSave({ decedentName: trimmedName, decedentMiddleName: middle.trim() || null })
          }
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

export function CaseInformationCard({
  decedentMiddleName,
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
  doNotContactNextOfKin,
  arrangementContactName,
  arrangementContactRelationship,
  arrangementContactPhone,
  arrangementContactEmail,
  contactInstructions,
  arrangementAuthorizationConfirmed,
  arrangementAuthorizationSource,
  isArchived,
  ssnField,
  onArchiveChange,
  archivePending,
  isMedicalExaminerCase,
  caseNumber,
  decedentName,
  certifierName,
  certifierPhone,
  certifierLicenseNumber,
  certifierFax,
  onSaveCertifierName,
  onSaveCertifierPhone,
  onSaveCertifierLicenseNumber,
  onSaveCertifierFax,
  tagNumber,
  dateOfCremation,
  showDateOfCremation = false,
  paymentStatus,
  paymentSummary = null,
  pickupStatus,
  pickupReleasedTo,
  pickupReleasedAt,
  pickupNote,
  returnMethod,
  shippingCarrier,
  shippingTrackingNumber,
  shippingDateShipped,
  shippingDeliveryStatus,
  shippingDeliveredAt,
  ownerStaffId,
  staffOptions,
  onReassignOwner,
  showOwner,
  onUpdateCaseInfo,
  onSaveWeight,
  onSaveTimeOfDeath,
  isVeteran,
  veteranFlagLocked,
  onToggleVeteran,
  vaSteps,
  vaCallbackDone,
  vaPublishChoice,
  vaNotificationResponsibility,
  onToggleVaStep,
  onSetVaPublishChoice,
  onSetVaNotificationResponsibility,
}: {
  decedentMiddleName?: string | null;
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
  /** Contact instructions (2026-10). Optional on the Case type — absent on
      every case that predates the columns — so each is defaulted at the
      single point of use below rather than every consumer repeating it. */
  doNotContactNextOfKin?: boolean;
  arrangementContactName?: string | null;
  arrangementContactRelationship?: string | null;
  arrangementContactPhone?: string | null;
  arrangementContactEmail?: string | null;
  contactInstructions?: string | null;
  arrangementAuthorizationConfirmed?: boolean;
  arrangementAuthorizationSource?: string | null;
  /** Archived Cases (2026-10). Omitted on any caller that does not offer
      archiving (the control simply does not render). */
  isArchived?: boolean;
  /** Case SSN (2026-10): the locked, last-four-only line, when the
      organization keeps SSNs (components/case/CaseSsnField.tsx). */
  ssnField?: React.ReactNode;
  onArchiveChange?: (archived: boolean) => void;
  archivePending?: boolean;
  /** Medical Examiner case (2026-10). Time of death, weight and certifier
      are often unavailable when the Arrangement Form is submitted,
      because the ME has not released them yet. A blank reads "Pending
      Medical Examiner" rather than as simply absent — display only, and
      deliberately so: a value SOLIS does not have is never invented or
      back-filled. */
  isMedicalExaminerCase?: boolean;
  /** Only used to name the case in the archive confirmation. */
  caseNumber?: string;
  decedentName?: string;
  /** Structured Certifier data (2026-09, ADR-041). Replaces the legacy
      free-text "Hospice/physician who will sign DC" intake concept for
      cases created under workflow template v5+ — null for any case whose
      workflowSnapshot predates this (including B2026-034, frozen at v3).
      Name/Phone drive the Certifier Information checklist item's
      completion (requiredCaseFields); License/Fax are optional and never
      block it. */
  certifierName: string | null;
  certifierPhone: string | null;
  certifierLicenseNumber: string | null;
  certifierFax: string | null;
  onSaveCertifierName: (value: string | null) => void;
  onSaveCertifierPhone: (value: string | null) => void;
  onSaveCertifierLicenseNumber: (value: string | null) => void;
  onSaveCertifierFax: (value: string | null) => void;
  /** Manors launch-prep. Operational chain-of-custody tag — null until
      staff assign one. */
  tagNumber: string | null;
  /** Date of Cremation (2026-10): the case's stored MM/DD/YYYY value, or
      null. Shown only when `showDateOfCremation` (an organization that
      issues the Certificate of Cremation). */
  dateOfCremation?: string | null;
  showDateOfCremation?: boolean;
  paymentStatus: PaymentStatus;
  /** What the verified payment records say (2026-10) — shown beside the
      stored value, never written back. Null with no Case Order, or when
      the viewer may not read orders and payments. */
  paymentSummary?: CasePaymentSummary | null;
  /** Manors launch-prep. Structured pickup/release tracking — see
      types/case.ts's own comment on why this exists separately from the
      free-text case log. */
  pickupStatus: PickupStatus;
  pickupReleasedTo: string | null;
  pickupReleasedAt: string | null;
  pickupNote: string | null;
  /** Conditional shipping/tracking (2026-09). Governs which of the pickup
      block above / shipping block below renders — see
      domain/cases/returnMethod.ts. Switching between values never clears
      the other's stored fields, only which block is shown. */
  returnMethod: ReturnMethod;
  shippingCarrier: string | null;
  shippingTrackingNumber: string | null;
  shippingDateShipped: string | null;
  shippingDeliveryStatus: ShippingDeliveryStatus | null;
  shippingDeliveredAt: string | null;
  ownerStaffId: string | null;
  staffOptions: StaffOption[];
  onReassignOwner: (staffId: string) => void;
  /** Task #17 (2026-09, hide Case Owner for Manors). Owner assignment
      still exists fully — this only controls whether its editor renders
      in Case Information for this organization. See
      domain/organization/caseOwnerVisibility.ts#shouldShowCaseOwner,
      which the caller (Case Detail page.tsx) resolves and passes down;
      this component stays a pure-props component with no org lookups of
      its own, matching its existing architecture. */
  showOwner: boolean;
  onUpdateCaseInfo: (patch: CaseUpdate) => void;
  /** Case field editing / field-backed checklist sync (2026-09). Distinct
      from onUpdateCaseInfo — saving Weight must also keep the First Call &
      Payment checklist's field-backed Weight item in sync (fieldValues),
      which requires the case's own workflowSnapshot; see
      hooks/useCaseMutations.ts#setWeight, this prop's intended wiring. */
  onSaveWeight: (value: string) => void;
  /** Case field editing / field-backed checklist sync (2026-09). Same
      shape/reason as onSaveWeight — see
      hooks/useCaseMutations.ts#setTimeOfDeath. */
  onSaveTimeOfDeath: (value: string) => void;
  isVeteran: boolean;
  veteranFlagLocked: boolean;
  onToggleVeteran: (newValue: boolean) => void;
  vaSteps: VaStepViewModel[];
  vaCallbackDone: boolean;
  vaPublishChoice: VaPublishChoice | null;
  vaNotificationResponsibility: VaNotificationResponsibility | null;
  onToggleVaStep: (index: number, newDone: boolean) => void;
  onSetVaPublishChoice: (choice: VaPublishChoice) => void;
  onSetVaNotificationResponsibility: (responsibility: VaNotificationResponsibility) => void;
}) {
  // Simplified release (2026-10). Choosing "Family Picked Up" opens ONE
  // dialog that records who collected the remains, the date (today by
  // default) and an optional note, and saves them with the status in a
  // single patch — the same dialog the workflow's final step uses. It
  // replaces a flow that revealed three separately-saved fields and only
  // committed the status once both required ones happened to be valid.
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const releaseSuggestions: ReleaseSuggestion[] = [
    { role: 'Next of kin', name: normalizeNextOfKinName(nextOfKinName, nextOfKinPhone) },
    { role: 'Arrangement contact', name: arrangementContactName },
  ];

  // Task #17 layout follow-up (2026-09): Return method's own control and
  // Cremated Remains' own control are each defined exactly once here and
  // placed into different rows depending on `showOwner` below — never
  // duplicated JSX/logic, just relocated. Identical markup/behavior to
  // what existed inline before this follow-up.
  /** See `isMedicalExaminerCase`'s own comment: display only. */
  const mePending = isMedicalExaminerCase ? PENDING_MEDICAL_EXAMINER_LABEL : undefined;

  const returnMethodControl = (
    <div>
      <div className={styles.fieldLabel}>Return method</div>
      <SelectField
        className={`${styles.paymentSelect} ${returnMethod === 'undecided' ? styles.paymentPending : styles.paymentSuccess}`}
        value={returnMethod}
        onChange={(e) => onUpdateCaseInfo({ returnMethod: e.target.value as ReturnMethod })}
      >
        <option value="undecided">{RETURN_METHOD_LABEL.undecided}</option>
        <option value="pickup">{RETURN_METHOD_LABEL.pickup}</option>
        <option value="shipping">{RETURN_METHOD_LABEL.shipping}</option>
      </SelectField>
    </div>
  );

  const crematedRemainsControl = (
    <div className={styles.fullRow}>
      <div className={styles.fieldLabel}>Cremated Remains</div>
      <SelectField
        className={`${styles.paymentSelect} ${pickupStatus === 'released' ? styles.paymentSuccess : styles.paymentPending}`}
        value={pickupStatus}
        onChange={(e) => {
          const next = e.target.value as PickupStatus;
          if (next === 'awaiting_pickup') {
            onUpdateCaseInfo({ pickupStatus: 'awaiting_pickup' });
            return;
          }
          // "Family Picked Up" is recorded through the release dialog;
          // nothing is saved until it is.
          setReleaseDialogOpen(true);
        }}
      >
        <option value="awaiting_pickup">{PICKUP_STATUS_LABEL.awaiting_pickup}</option>
        <option value="released">{PICKUP_STATUS_LABEL.released}</option>
      </SelectField>
    </div>
  );

  const [editingName, setEditingName] = useState(false);
  const isReadOnlyCard = isArchived === true;

  return (
    /* Archived cases are read-only (2026-10). The provider covers every
       field and select below. The Restore row at the foot is deliberately
       unaffected — it uses its own button rather than these primitives —
       because restoring IS the authorized way out of this state and must
       stay available. */
    <ReadOnlyContext.Provider value={isArchived === true}>
    <div className={styles.card}>
      <div className={styles.title}>Case information</div>
      {isArchived === true && (
        <p className={styles.archivedNotice}>
          This case is archived and is shown read-only. Restore it to make changes.
        </p>
      )}
      <div className={styles.grid}>
        {/* Deceased name (2026-10). ONE complete name — first, middle and
            last together — not a name plus a separate middle-name box.
            A middle name is part of someone's name, not a property of
            their case, and showing it on its own line invited reading it
            as a separate fact.
            `decedentMiddleName` is still stored, still mapped from all
            three JotForm forms, and still searchable; it simply has no
            standalone field here. It reaches this card only to be
            composed into the name below. */}
        <div className={styles.fullNameRow}>
          <div className={styles.fieldLabel}>Name</div>
          <div className={styles.fullNameLine}>
            <span className={styles.fullNameValue}>
              {toDisplayName(composeDecedentName(decedentName ?? '', decedentMiddleName)) || '—'}
            </span>
            {/* Archived cases stay read-only — the control is absent, not
                merely disabled, so nothing offers an edit that the server
                would refuse. */}
            {!isReadOnlyCard && (
              <button type="button" className={styles.editNameButton} onClick={() => setEditingName(true)}>
                Edit Name
              </button>
            )}
          </div>
        </div>
        <EditNameDialog
          open={editingName}
          decedentName={decedentName ?? ''}
          decedentMiddleName={decedentMiddleName ?? null}
          onCancel={() => setEditingName(false)}
          onSave={(next) => {
            setEditingName(false);
            onUpdateCaseInfo(next);
          }}
        />
        <EditableField
          label="Date of birth"
          value={dateOfBirth}
          kind="date"
          onSave={(v) => onUpdateCaseInfo({ dateOfBirth: v })}
          crossFieldValidate={(v) => getDateOfBirthFutureError(v) ?? getDateOfBirthDeathOrderError(v, dateOfDeath)}
        />
        <EditableField
          label="Date of death"
          value={dateOfDeath}
          kind="date"
          onSave={(v) => onUpdateCaseInfo({ dateOfDeath: v })}
          crossFieldValidate={(v) => getDateOfDeathFutureError(v) ?? getDateOfBirthDeathOrderError(dateOfBirth, v)}
        />
        <TwelveHourTimeField
          label="Time of death"
          emptyLabel={mePending}
          value={timeOfDeath}
          onSave={(v) => onSaveTimeOfDeath(v)}
        />
        {/* Weight beside Time of death, SSN further down beside the
            veteran flag (2026-10): short values pair up, no empty half-rows. */}
        <EditableField
          label="Weight"
          emptyLabel={mePending}
          value={weight}
          onSave={(v) => onSaveWeight(v)}
          valueClassName={`${styles.weightValue} ${weightOver200 ? styles.weightOver : styles.weightNormal}`}
          trailingBadge={weightOver200 ? <span className={styles.notifyBadge}>Notify crematory</span> : null}
        />
        {/* Tag Number (2026-10). With the deceased's identifying details,
            so it is the first thing staff see — and a missing one is
            noticed — rather than sitting in the operational row further
            down. The SAME field, validation and patch as before; saving it
            is still what triggers the Envelope/Certificate server-side. */}
        <EditableField
          label="Tag Number"
          value={tagNumber ?? ''}
          uppercase
          valueClassName={styles.tagNumberValue}
          missing={{ prompt: 'Tag Number Missing — Add Tag Number', readOnlyText: 'Tag Number Missing' }}
          onSave={(v) => onUpdateCaseInfo({ tagNumber: v.trim().length > 0 ? v.trim() : null })}
        />
        {/* Date of Cremation (2026-10). The same case field the Schedule
            tab edits (one value, one query cache, so both always agree),
            next to the other key dates; Tag Number keeps its place above.
            Saved as typed (MM/DD/YYYY) — never through a Date object, so
            no timezone can move the day. A valid date here satisfies the
            Certificate's date requirement through the same server-side
            trigger the Schedule tab's edit uses. Removing a recorded date
            takes the explicit, confirmed "Clear" — an emptied box reverts. */}
        {showDateOfCremation && (
          <EditableField
            label="Date of Cremation"
            value={dateOfCremation ?? ''}
            kind="date"
            required
            emptyLabel="Not recorded"
            onSave={(v) => onUpdateCaseInfo({ dateOfCremation: v })}
            clear={{
              confirmText: 'Clear the Date of Cremation? Existing Certificates are kept; no new one is generated.',
              onConfirm: () => onUpdateCaseInfo({ dateOfCremation: null }),
            }}
            crossFieldValidate={(v) => getFutureDateError(v, 'Date of Cremation') ?? getCremationBeforeDeathError(v, dateOfDeath)}
          />
        )}
        <EditableField
          label="Location"
          value={placeOfDeath}
          uppercase
          onSave={(v) => onUpdateCaseInfo({ placeOfDeath: v })}
        />
        {ssnField}
        {/* Served in the armed forces (2026-10): with the identifying
            details rather than at the foot of the card. */}
        <div
          className={`${styles.veteranRow} ${styles.veteranCell} ${veteranFlagLocked ? styles.veteranRowLocked : styles.veteranRowUnlocked}`}
          onClick={veteranFlagLocked ? undefined : () => onToggleVeteran(!isVeteran)}
        >
          <Checkbox
            checked={isVeteran}
            disabled={veteranFlagLocked}
            onChange={veteranFlagLocked ? undefined : () => onToggleVeteran(!isVeteran)}
            tone="brand"
            aria-label="Served in the armed forces"
          />
          <span className={styles.veteranLabel}>
            Served in the armed forces
            {veteranFlagLocked && <span className={styles.veteranLockedNote}>editable during First Call &amp; Payment only</span>}
          </span>
        </div>
      </div>
      {isVeteran && (
        <VaNotificationPanel
          vaSteps={vaSteps}
          vaCallbackDone={vaCallbackDone}
          vaPublishChoice={vaPublishChoice}
          vaNotificationResponsibility={vaNotificationResponsibility}
          onToggleStep={onToggleVaStep}
          onSetPublishChoice={onSetVaPublishChoice}
          onSetVaNotificationResponsibility={onSetVaNotificationResponsibility}
        />
      )}

      <div className={styles.sectionHeading}>Next of kin / primary contact</div>
      <div className={styles.grid}>
        <EditableField
          label="Next of kin"
          value={normalizeNextOfKinName(nextOfKinName, nextOfKinPhone)}
          uppercase
          onSave={(v) => onUpdateCaseInfo({ nextOfKinName: v })}
        />
        <EditableField
          label="NOK phone"
          kind="phone"
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
            uppercase
            onSave={(v) => onUpdateCaseInfo({ nextOfKinRelationshipOther: v.trim().length > 0 ? v.trim() : null })}
          />
        )}
      </div>

      <ContactInstructionsSection
        doNotContactNextOfKin={doNotContactNextOfKin ?? false}
        arrangementContactName={arrangementContactName ?? null}
        arrangementContactRelationship={arrangementContactRelationship ?? null}
        arrangementContactPhone={arrangementContactPhone ?? null}
        arrangementContactEmail={arrangementContactEmail ?? null}
        contactInstructions={contactInstructions ?? null}
        arrangementAuthorizationConfirmed={arrangementAuthorizationConfirmed ?? false}
        arrangementAuthorizationSource={arrangementAuthorizationSource ?? null}
        nextOfKinName={normalizeNextOfKinName(nextOfKinName, nextOfKinPhone)}
        onUpdateCaseInfo={onUpdateCaseInfo}
      />

      <div className={styles.sectionHeading}>Certifier information</div>
      <div className={styles.sectionHelperText}>
        Medical certifier responsible for signing the death certificate.
      </div>
      <div className={styles.grid}>
        <EditableField
          label="Certifier name"
          emptyLabel={mePending}
          value={certifierName ?? ''}
          uppercase
          onSave={(v) => onSaveCertifierName(v.trim().length > 0 ? v.trim() : null)}
        />
        <EditableField
          label="Certifier phone"
          kind="phone"
          value={certifierPhone ?? ''}
          onSave={(v) => onSaveCertifierPhone(v.trim().length > 0 ? v.trim() : null)}
        />
        <EditableField
          label="Certifier license #"
          value={certifierLicenseNumber ?? ''}
          uppercase
          onSave={(v) => onSaveCertifierLicenseNumber(v.trim().length > 0 ? v.trim() : null)}
        />
        <EditableField
          label="Certifier fax"
          kind="phone"
          value={certifierFax ?? ''}
          onSave={(v) => onSaveCertifierFax(v.trim().length > 0 ? v.trim() : null)}
        />
      </div>

      {/* Task #17 layout follow-up (2026-09): for Manors (showOwner=false),
          Payment/Return method/Cremated Remains consolidate onto one row
          (Tag Number moved up to the identifying details, 2026-10) (Cremated Remains only joins it when
          returnMethod === 'pickup' — it has never applied to Shipping, so
          column 4 is simply absent rather than filled with an invented
          control there; see crematedRemainsControl's own comment).
          Generic organizations (showOwner=true) keep their exact prior
          three-grid structure: Payment, then Owner+Return method
          together (Task #16), then Cremated Remains inside the conditional
          details grid below (unchanged placement/order). */}
      <div className={`${styles.grid} ${styles.operationalRow}`}>
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
          {paymentSummary && <PaymentSummaryLine summary={paymentSummary} />}
        </div>
        {!showOwner && (
          <>
            {returnMethodControl}
            {returnMethod === 'pickup' && crematedRemainsControl}
          </>
        )}
      </div>

      {/* Task #16 (2026-09): Owner and Return method share their own
          dedicated grid — exactly two items, so they always land in the
          same row together (Owner left, Return method right) regardless
          of how many columns the auto-fill grid computes elsewhere on
          this card, rather than depending on how many items happened to
          precede them. Generic organizations only (Task #17 layout
          follow-up folds Return method into the row above for Manors). */}
      {showOwner && (
        <div className={`${styles.grid} ${styles.operationalRow}`}>
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
          {returnMethodControl}
        </div>
      )}

      <RecordPickupDialog
        open={releaseDialogOpen}
        onClose={() => setReleaseDialogOpen(false)}
        initialReleasedTo={pickupReleasedTo}
        initialReleasedAt={pickupReleasedAt}
        initialNote={pickupNote}
        suggestions={releaseSuggestions}
        onSave={(patch) => {
          setReleaseDialogOpen(false);
          onUpdateCaseInfo(patch);
        }}
      />

      <div className={`${styles.grid} ${styles.operationalRow}`}>
        {returnMethod === 'pickup' && (
          <>
            {showOwner && crematedRemainsControl}
            {pickupStatus === 'released' && (
              <div className={styles.releaseRecord}>
                <div className={styles.fieldLabel}>Released</div>
                <div>
                  Released to <b>{pickupReleasedTo ?? '—'}</b>
                  {pickupReleasedAt ? ` on ${pickupReleasedAt}` : ''}
                  {pickupNote ? ` · ${pickupNote}` : ''}
                </div>
                {!isReadOnlyCard && (
                  <button type="button" className={styles.editNameButton} onClick={() => setReleaseDialogOpen(true)}>
                    Correct release
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {returnMethod === 'shipping' && (
          <>
            <EditableField
              label="Carrier"
              value={shippingCarrier ?? ''}
              uppercase
              onSave={(v) => onUpdateCaseInfo({ shippingCarrier: v.trim().length > 0 ? v.trim() : null })}
            />
            <EditableField
              label="Tracking number"
              value={shippingTrackingNumber ?? ''}
              uppercase
              onSave={(v) => onUpdateCaseInfo({ shippingTrackingNumber: v.trim().length > 0 ? v.trim() : null })}
            />
            <EditableField
              label="Date shipped"
              value={shippingDateShipped ?? ''}
              kind="date"
              onSave={(v) => onUpdateCaseInfo({ shippingDateShipped: v.trim().length > 0 ? v.trim() : null })}
              crossFieldValidate={(v) => getFutureDateError(v, 'Date shipped')}
            />
            <div>
              <div className={styles.fieldLabel}>Shipping status</div>
              <SelectField
                className={`${styles.paymentSelect} ${shippingDeliveryStatus === 'delivered' ? styles.paymentSuccess : styles.paymentPending}`}
                value={shippingDeliveryStatus ?? ''}
                onChange={(e) =>
                  onUpdateCaseInfo({
                    shippingDeliveryStatus: e.target.value ? (e.target.value as ShippingDeliveryStatus) : null,
                  })
                }
              >
                <option value="">Not yet shipped</option>
                <option value="shipped">{SHIPPING_DELIVERY_STATUS_LABEL.shipped}</option>
                <option value="delivered">{SHIPPING_DELIVERY_STATUS_LABEL.delivered}</option>
              </SelectField>
            </div>
            <EditableField
              label="Delivered date"
              value={shippingDeliveredAt ?? ''}
              kind="date"
              onSave={(v) => onUpdateCaseInfo({ shippingDeliveredAt: v.trim().length > 0 ? v.trim() : null })}
              crossFieldValidate={(v) => getFutureDateError(v, 'Delivered date')}
            />
          </>
        )}
      </div>


      {/* Automatic archiving (2026-10): there is no manual "Archive
          case" action any more — a case files itself away the moment it
          genuinely completes. What remains is the archived-state notice
          and Restore, which staff still need when a finished case turns
          out to need correcting. */}
      {onArchiveChange && isArchived === true && (
        <ArchiveCaseSection
          isArchived
          caseNumber={caseNumber ?? ''}
          decedentName={decedentName ?? 'This case'}
          onChange={onArchiveChange}
          pending={archivePending === true}
        />
      )}

    </div>
    </ReadOnlyContext.Provider>
  );
}

/**
 * The payment records' own answer under the stored "Payment" value
 * (2026-10). Amounts always; the status word only when it adds something
 * the select cannot say (partly paid) or disagrees with it.
 */
function PaymentSummaryLine({ summary }: { summary: CasePaymentSummary }) {
  const toneClass = summary.mismatch ? styles.paymentSummaryWarning : summary.tone === 'success' ? styles.paymentSummarySuccess : summary.tone === 'warning' ? styles.paymentSummaryWarning : '';
  const showLabel = summary.state === 'partial_payment' || summary.mismatch !== null;
  return (
    <div className={`${styles.paymentSummary} ${toneClass}`} data-payment-state={summary.state}>
      <span>
        {showLabel && <strong className={styles.paymentSummaryLabel}>{summary.label} · </strong>}
        {summary.detail}
      </span>
      {summary.mismatch === 'marked_paid_with_balance' && (
        <span className={styles.paymentSummaryNote}>Payment records still show a balance due.</span>
      )}
      {summary.mismatch === 'paid_but_not_marked' && <span className={styles.paymentSummaryNote}>Payment records show this case is paid.</span>}
    </div>
  );
}
