'use client';

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { SelectField } from '@/components/ui/SelectField';
import textFieldStyles from '@/components/ui/TextField.module.css';
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
  splitMilitaryTimeToTwelveHourParts,
  combineTwelveHourTimeParts,
  formatMilitaryTimeToTwelveHour,
} from '@/utils/inputMask';
import { VaNotificationPanel } from './VaNotificationPanel';
import { NEXT_OF_KIN_RELATIONSHIP_OPTIONS } from '@/domain/cases/nextOfKinRelationship';
import { isValidPickupReleaseDetail } from '@/domain/cases/pickupRelease';
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
function EditableField({
  label,
  value,
  onSave,
  kind = 'text',
  uppercase = false,
  crossFieldValidate,
  valueClassName,
  trailingBadge,
}: {
  label: string;
  value: string;
  onSave: (newValue: string) => void;
  kind?: 'text' | 'date' | 'time' | 'email';
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
      if (expanded !== '' && (!isValidCalendarDate(expanded) || crossFieldValidate?.(expanded))) {
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
          <button type="button" className={`${styles.editableValue} ${valueClassName ?? ''}`} onClick={startEditing}>
            {displayValue || '—'}
          </button>
          {trailingBadge}
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
function TwelveHourTimeField({ label, value, onSave }: { label: string; value: string; onSave: (newValue: string) => void }) {
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
      ) : (
        <button type="button" className={styles.editableValue} onClick={startEditing}>
          {formatMilitaryTimeToTwelveHour(displayValue) || '—'}
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
  certifierName,
  certifierPhone,
  certifierLicenseNumber,
  certifierFax,
  onSaveCertifierName,
  onSaveCertifierPhone,
  onSaveCertifierLicenseNumber,
  onSaveCertifierFax,
  tagNumber,
  paymentStatus,
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
  paymentStatus: PaymentStatus;
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
  // Staff-facing terminology (2026-09): selecting "Family Picked Up" must
  // not immediately persist pickupStatus === 'released' unless Released
  // to/Released date are already valid (see domain/cases/pickupRelease.ts).
  // `pendingPickupRelease` reveals the detail fields for entry the moment
  // "Family Picked Up" is chosen, without yet writing pickupStatus — the
  // effect below commits it automatically once both fields become valid.
  // Selecting back to "Awaiting Family Pickup" is never gated and always
  // clears this immediately (see the onChange handler below).
  const [pendingPickupRelease, setPendingPickupRelease] = useState(false);

  useEffect(() => {
    if (pendingPickupRelease && pickupStatus !== 'released' && isValidPickupReleaseDetail(pickupReleasedTo, pickupReleasedAt)) {
      setPendingPickupRelease(false);
      onUpdateCaseInfo({ pickupStatus: 'released' });
    }
  }, [pendingPickupRelease, pickupStatus, pickupReleasedTo, pickupReleasedAt, onUpdateCaseInfo]);

  return (
    <div className={styles.card}>
      <div className={styles.title}>Case information</div>
      <div className={styles.grid}>
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
          value={timeOfDeath}
          onSave={(v) => onSaveTimeOfDeath(v)}
        />
        <EditableField
          label="Location"
          value={placeOfDeath}
          uppercase
          onSave={(v) => onUpdateCaseInfo({ placeOfDeath: v })}
        />
        <EditableField
          label="Weight"
          value={weight}
          onSave={(v) => onSaveWeight(v)}
          valueClassName={`${styles.weightValue} ${weightOver200 ? styles.weightOver : styles.weightNormal}`}
          trailingBadge={weightOver200 ? <span className={styles.notifyBadge}>Notify crematory</span> : null}
        />
      </div>

      <div className={styles.sectionHeading}>Next of kin / primary contact</div>
      <div className={styles.grid}>
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
            uppercase
            onSave={(v) => onUpdateCaseInfo({ nextOfKinRelationshipOther: v.trim().length > 0 ? v.trim() : null })}
          />
        )}
      </div>

      <div className={styles.sectionHeading}>Certifier information</div>
      <div className={styles.sectionHelperText}>
        Medical certifier responsible for signing the death certificate.
      </div>
      <div className={styles.grid}>
        <EditableField
          label="Certifier name"
          value={certifierName ?? ''}
          uppercase
          onSave={(v) => onSaveCertifierName(v.trim().length > 0 ? v.trim() : null)}
        />
        <EditableField
          label="Certifier phone"
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
          value={certifierFax ?? ''}
          onSave={(v) => onSaveCertifierFax(v.trim().length > 0 ? v.trim() : null)}
        />
      </div>

      <div className={styles.grid}>
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

        {returnMethod === 'pickup' && (
          <>
            <div>
              <div className={styles.fieldLabel}>Cremated Remains</div>
              <SelectField
                className={`${styles.paymentSelect} ${pickupStatus === 'released' ? styles.paymentSuccess : styles.paymentPending}`}
                value={pickupStatus === 'released' || pendingPickupRelease ? 'released' : 'awaiting_pickup'}
                onChange={(e) => {
                  const next = e.target.value as PickupStatus;
                  if (next === 'awaiting_pickup') {
                    setPendingPickupRelease(false);
                    onUpdateCaseInfo({ pickupStatus: 'awaiting_pickup' });
                    return;
                  }
                  // Selecting "Family Picked Up": only persist immediately if
                  // Released to/Released date are already valid (e.g.
                  // already filled in earlier, or supplied by Jotform
                  // reconciliation) — otherwise reveal the detail fields
                  // below and wait for both to become valid; see this
                  // component's own top-of-function effect.
                  if (isValidPickupReleaseDetail(pickupReleasedTo, pickupReleasedAt)) {
                    onUpdateCaseInfo({ pickupStatus: 'released' });
                  } else {
                    setPendingPickupRelease(true);
                  }
                }}
              >
                <option value="awaiting_pickup">{PICKUP_STATUS_LABEL.awaiting_pickup}</option>
                <option value="released">{PICKUP_STATUS_LABEL.released}</option>
              </SelectField>
            </div>
            {(pickupStatus === 'released' || pendingPickupRelease) && (
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
                  crossFieldValidate={(v) => getFutureDateError(v, 'Released date')}
                />
                <EditableField
                  label="Pickup note (optional)"
                  value={pickupNote ?? ''}
                  uppercase
                  onSave={(v) => onUpdateCaseInfo({ pickupNote: v.trim().length > 0 ? v.trim() : null })}
                />
                {pendingPickupRelease && pickupStatus !== 'released' && (
                  <div className={styles.fieldError} role="alert">
                    Released to and Released date are required to mark Family Picked Up.
                  </div>
                )}
              </>
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
          vaNotificationResponsibility={vaNotificationResponsibility}
          onToggleStep={onToggleVaStep}
          onSetPublishChoice={onSetVaPublishChoice}
          onSetVaNotificationResponsibility={onSetVaNotificationResponsibility}
        />
      )}
    </div>
  );
}
