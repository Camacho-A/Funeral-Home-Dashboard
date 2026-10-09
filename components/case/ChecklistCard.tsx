import { useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { splitMilitaryTimeToTwelveHourParts, combineTwelveHourTimeParts, isValidEmail } from '@/utils/inputMask';
import { Modal } from '@/components/ui/Modal';
import { isValidPickupReleaseDetail } from '@/domain/cases/pickupRelease';
import { formatDateInput, isValidCalendarDate, expandTwoDigitYearInDateInput } from '@/utils/inputMask';
import type { CaseUpdate } from '@/types/case';
import type { ChecklistItemViewModel } from '@/types/caseViewModel';
import styles from './ChecklistCard.module.css';

/**
 * The stage-specific checklist. `viewingStageLabel` non-null means these
 * items are a *past* stage's, shown read-only (see the page's
 * viewingDisplayStage local state, threaded through useCaseViewModel).
 * Toggling/field-editing is disabled whenever an item is locked, is a
 * plain checkbox item hasn't a field, or the whole card is in read-only
 * viewing mode — matching design/support.js's toggle() no-op conditions
 * exactly, enforced here via the Checkbox/TextField `disabled` prop rather
 * than an onClick that silently does nothing.
 */

/**
 * Editable-field save-race fix (2026-09). A field-backed checklist item's
 * textbox used to be a bare, fully-controlled `<TextField value={item.
 * fieldValue} onChange={(e) => onFieldChange(item.index, e.target.value)}>`
 * — every keystroke called `onFieldChange` directly, which
 * hooks/useCaseMutations.ts#setFieldValue turns straight into a real
 * `updateCase.mutate(...)` (a live PATCH in Wix mode). Typing "150" fired
 * three separate saves ("1", "15", "150"); with real network latency, a
 * slower request for an earlier keystroke could resolve *after* a faster
 * request for a later one and win the query-cache write, visibly reverting
 * what the user had already typed — exactly matching the reported
 * "must pause and wait for it to settle" symptom.
 *
 * This wraps the same field in local draft state and commits (calls
 * onFieldChange) only on blur or Enter — mirroring
 * components/case/CaseInformationCard.tsx's EditableField's own commit
 * timing and its `pendingValue` echo-until-confirmed mechanism (so the
 * just-typed value doesn't flicker back to a stale `value` prop for the
 * gap between "save fired" and "the mutation's response reaches the query
 * cache"). Unlike EditableField, there's no separate button/input toggle
 * here — the textbox is always visible for a field-backed item — so
 * "entering edit mode" is simply focusing it; the field keeps showing the
 * live `value` prop whenever it isn't focused, so an external update (a
 * completed save, a refetch) is reflected immediately when the user isn't
 * actively typing, without ever overwriting an in-progress edit.
 *
 * Applies uniformly to every field-backed checklist item (this is the
 * shared component every one of them renders through), not a Weight-only
 * patch — the same per-keystroke-save defect existed for all of them.
 *
 * `uppercase`/`validate`/`invalidMessage` (Task #7 UI consistency follow-
 * up, 2026-09): optional, additive — mirror
 * CaseInformationCard.tsx#EditableField's own `uppercase` live-transform
 * and kind='email' validate-before-commit/revert-on-blur behavior, reused
 * here (not reinvented) so a structured field edited from the Workflow
 * checklist behaves identically to the same field edited from Case
 * Information. An invalid non-empty value never commits: Enter shows an
 * inline error and preserves the typed text for correction; blur silently
 * reverts to the last good value — matching EditableField's own
 * asymmetric handling exactly.
 */
function ChecklistFieldInput({
  value,
  isPassword,
  disabled,
  onCommit,
  uppercase,
  validate,
  invalidMessage,
}: {
  value: string;
  isPassword: boolean;
  disabled: boolean;
  onCommit: (newValue: string) => void;
  uppercase?: boolean;
  validate?: (value: string) => boolean;
  invalidMessage?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pendingValue !== null && value === pendingValue) setPendingValue(null);
  }, [value, pendingValue]);

  const displayValue = pendingValue ?? value;

  function isValidDraft(candidate: string) {
    return candidate === '' || !validate || validate(candidate);
  }

  function commit() {
    if (!isValidDraft(draft)) return;
    if (draft !== displayValue) {
      setPendingValue(draft);
      onCommit(draft);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!isValidDraft(draft)) {
        setError(invalidMessage ?? 'Enter a valid value.');
        return;
      }
      setError(null);
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(displayValue);
      setError(null);
      setIsFocused(false);
    }
  }

  return (
    <div className={styles.fieldInputWrap}>
      <TextField
        className={styles.fieldInput}
        type={isPassword ? 'password' : 'text'}
        value={isFocused ? draft : displayValue}
        onFocus={() => {
          setDraft(displayValue);
          setIsFocused(true);
          setError(null);
        }}
        onChange={(e) => setDraft(uppercase ? e.target.value.toUpperCase() : e.target.value)}
        onBlur={() => {
          if (isValidDraft(draft)) commit();
          else setDraft(displayValue);
          setIsFocused(false);
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Enter value to complete this step…"
      />
      {error && (
        <div className={styles.fieldError} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
type TwelveHourParts = { hour: string; minute: string; period: '' | 'AM' | 'PM' };

/**
 * Checklist Time Display (2026-09, ADR-041). A field-backed item whose
 * template metadata sets `valueKind: 'time'` (Time of Death today, driven
 * declaratively — not a label match) renders three closed-option selects
 * instead of ChecklistFieldInput's free-text box, mirroring
 * CaseInformationCard's TwelveHourTimeField reasoning: the canonical
 * persisted value is still strict 24-hour "HH:mm".
 *
 * Preserves the exact save-race fix ChecklistFieldInput established above
 * (commit only on a real "done editing" signal, never per-keystroke/
 * per-selection) — but three separate <select>s have no single element to
 * blur from, so "done editing" is instead "focus left the whole group"
 * (checked via the container's onBlur + e.relatedTarget), plus Enter/
 * Escape via the same container's onKeyDown. Moving focus *between* the
 * three selects (e.g. hour -> minute) is not a commit and must not reset
 * the in-progress selection — isEditing gates startEditing() to fire only
 * on the first focus into the group, never on every intra-group focus
 * change.
 */
function ChecklistTimeInput({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (newValue: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftParts, setDraftParts] = useState<TwelveHourParts>(() => splitMilitaryTimeToTwelveHourParts(value));
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  useEffect(() => {
    if (pendingValue !== null && value === pendingValue) setPendingValue(null);
  }, [value, pendingValue]);

  const displayValue = pendingValue ?? value;
  const shownParts = isEditing ? draftParts : splitMilitaryTimeToTwelveHourParts(displayValue);

  function handleGroupFocus() {
    if (!isEditing) {
      setDraftParts(splitMilitaryTimeToTwelveHourParts(displayValue));
      setIsEditing(true);
    }
  }

  function commitIfComplete() {
    const combined = combineTwelveHourTimeParts(draftParts.hour, draftParts.minute, draftParts.period);
    if (combined !== null && combined !== displayValue) {
      setPendingValue(combined);
      onCommit(combined);
    }
  }

  function handleGroupBlur(e: FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsEditing(false);
    commitIfComplete();
  }

  function handleGroupKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitIfComplete();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraftParts(splitMilitaryTimeToTwelveHourParts(displayValue));
      setIsEditing(false);
    }
  }

  return (
    <div
      className={styles.timeFieldGroup}
      onFocus={handleGroupFocus}
      onBlur={handleGroupBlur}
      onKeyDown={handleGroupKeyDown}
    >
      <SelectField
        aria-label="Hour"
        value={shownParts.hour}
        disabled={disabled}
        onChange={(e) => setDraftParts((prev) => ({ ...prev, hour: e.target.value }))}
      >
        <option value="">--</option>
        {HOUR_OPTIONS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </SelectField>
      <span className={styles.timeColon}>:</span>
      <SelectField
        aria-label="Minute"
        value={shownParts.minute}
        disabled={disabled}
        onChange={(e) => setDraftParts((prev) => ({ ...prev, minute: e.target.value }))}
      >
        <option value="">--</option>
        {MINUTE_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </SelectField>
      <SelectField
        aria-label="AM or PM"
        value={shownParts.period}
        disabled={disabled}
        onChange={(e) => setDraftParts((prev) => ({ ...prev, period: e.target.value as '' | 'AM' | 'PM' }))}
      >
        <option value="">--</option>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </SelectField>
    </div>
  );
}

/**
 * Task #7 follow-up (2026-09). A `requiredCaseFields` item's editable
 * surface — currently only Certifier Information's
 * ['certifierName', 'certifierPhone'] — reusing ChecklistFieldInput per
 * field (the same save-race-safe textbox every hasField item already
 * uses) rather than inventing a new input component. Deliberately not a
 * fully generic "render any Case field by name" renderer: only the field
 * names in REQUIRED_CASE_FIELD_META are rendered at all, so an
 * unrecognized future requiredCaseFields entry is silently skipped here
 * rather than guessed at.
 *
 * Certifier fields write through their own dedicated onSave callbacks
 * (hooks/useCaseMutations.ts's setCertifierName/setCertifierPhone, which
 * build a `{ certifierX: value }`-only patch) — the exact same path Case
 * Information's own Certifier fields already use. Family Contact fields
 * (Task #7 UI consistency follow-up, 2026-09) write through the single
 * generic `onUpdateCaseInfo` callback instead, mirroring exactly how
 * CaseInformationCard.tsx's own "Next of kin"/"NOK phone"/"NOK email"
 * fields already save — no new mutation, no fieldValues mirror, and the
 * legacy combined fieldValues entry (if any) is never read or touched
 * either way.
 *
 * `disabled` deliberately does NOT include the card's `readOnly` (past-
 * stage viewing) flag at the call site below — these are all live Case
 * data, not part of the frozen stage snapshot, so staff must be able to
 * complete or correct them from an earlier stage's view exactly as they
 * already can from Case Information. `item.locked` still applies (always
 * false for a past-stage item anyway — see resolveChecklist.ts).
 * Server-side Case Information edit permission remains the authoritative
 * gate, identical to every other structured-field edit path.
 */
type RequiredCaseFieldMeta = {
  label: string;
  uppercase?: boolean;
  validate?: (value: string) => boolean;
  invalidMessage?: string;
};

const REQUIRED_CASE_FIELD_META: Record<string, RequiredCaseFieldMeta> = {
  certifierName: { label: 'Certifier name' },
  certifierPhone: { label: 'Certifier phone' },
  nextOfKinName: { label: 'Next of kin', uppercase: true },
  nextOfKinPhone: { label: 'NOK phone' },
  nextOfKinEmail: { label: 'NOK email', validate: isValidEmail, invalidMessage: 'Enter a valid email address.' },
};

function RequiredCaseFieldsGroup({
  item,
  disabled,
  onSaveCertifierName,
  onSaveCertifierPhone,
  onUpdateCaseInfo,
  contactRestriction,
}: {
  item: ChecklistItemViewModel;
  disabled: boolean;
  onSaveCertifierName?: (value: string | null) => void;
  onSaveCertifierPhone?: (value: string | null) => void;
  /** Widened from Record<string, string | null> for the terminal
      return-of-remains action below, which must send `pickupStatus`
      together with its release detail in ONE patch (see
      TerminalReturnAction). Every existing caller is unaffected — the page
      already passes `mutations.updateCaseInfo`, which takes a CaseUpdate. */
  onUpdateCaseInfo?: (patch: CaseUpdate) => void;
  contactRestriction?: { active: boolean; arrangementContactName: string | null };
}) {
  const fields = item.requiredCaseFields ?? [];
  const values = item.requiredCaseFieldValues ?? {};

  function saveField(field: string, value: string | null) {
    if (field === 'certifierName') onSaveCertifierName?.(value);
    else if (field === 'certifierPhone') onSaveCertifierPhone?.(value);
    else onUpdateCaseInfo?.({ [field]: value });
  }

  // Only the next-of-kin group carries the warning — a Certifier group has
  // nothing to do with how the family wants to be contacted.
  const showRestriction = Boolean(contactRestriction?.active) && fields.includes('nextOfKinName');

  return (
    <div className={styles.requiredFieldsGroup}>
      {showRestriction && (
        <p className={styles.contactRestrictionNotice} role="note">
          <b>Do not contact next of kin directly.</b>{' '}
          {contactRestriction?.arrangementContactName
            ? `Route contact through ${contactRestriction.arrangementContactName} — see Contact instructions in Case Information.`
            : 'See Contact instructions in Case Information.'}
        </p>
      )}
      {fields
        .filter((field) => REQUIRED_CASE_FIELD_META[field])
        .map((field) => {
          const meta = REQUIRED_CASE_FIELD_META[field];
          return (
            <div className={styles.requiredFieldRow} key={field}>
              <span className={styles.requiredFieldLabel}>{meta.label}</span>
              <ChecklistFieldInput
                value={values[field] ?? ''}
                isPassword={false}
                disabled={disabled}
                uppercase={meta.uppercase}
                validate={meta.validate}
                invalidMessage={meta.invalidMessage}
                onCommit={(newValue) => {
                  const trimmed = newValue.trim();
                  saveField(field, trimmed.length > 0 ? trimmed : null);
                }}
              />
            </div>
          );
        })}
    </div>
  );
}

export function ChecklistCard({
  checklist,
  viewingStageLabel,
  onBackToCurrentStage,
  onToggleItem,
  onFieldChange,
  onSaveCertifierName,
  onSaveCertifierPhone,
  onUpdateCaseInfo,
  contactRestriction,
}: {
  checklist: ChecklistItemViewModel[];
  viewingStageLabel: string | null;
  onBackToCurrentStage: () => void;
  onToggleItem: (index: number, newDone: boolean) => void;
  onFieldChange: (index: number, value: string) => void;
  onSaveCertifierName?: (value: string | null) => void;
  onSaveCertifierPhone?: (value: string | null) => void;
  /** Task #7 UI consistency follow-up (2026-09). Family Contact's
      structured Name/Phone/Email fields save through this single generic
      callback — the exact same one CaseInformationCard.tsx's own "Next of
      kin"/"NOK phone"/"NOK email" fields already use — never a dedicated
      per-field mutation. */
  onUpdateCaseInfo?: (patch: CaseUpdate) => void;
  /** Contact instructions (2026-10). The Family Contact checklist item
      presents the next of kin's name/phone/email as the people to call. If
      the family has asked that the next of kin NOT be contacted directly,
      this surface would otherwise keep offering their number with no
      warning — so the restriction travels here too, rather than living
      only on Case Information. Display-only: this component never writes
      the restriction, it only refuses to present a contact as preferred
      when one is active. */
  contactRestriction?: { active: boolean; arrangementContactName: string | null };
}) {
  const readOnly = viewingStageLabel !== null;

  return (
    <div className={styles.card}>
      <div className={styles.title}>Checklist</div>
      <div className={styles.subtitle}>Required steps for this stage</div>

      {viewingStageLabel && (
        <div className={styles.viewingBanner}>
          <span>
            Viewing <b>{viewingStageLabel}</b> — read only
          </span>
          <button type="button" className={styles.backToCurrentButton} onClick={onBackToCurrentStage}>
            Back to current stage
          </button>
        </div>
      )}

      <div className={styles.list}>
        {checklist.map((item) => {
          // Conditional shipping/tracking (2026-09): the terminal return-of-
          // remains item is computed from returnMethod +
          // pickupStatus/shippingDeliveryStatus (domain/cases/returnMethod.ts)
          // — never independently toggleable, or it would become a second,
          // contradicting completion signal alongside the structured data
          // that actually drives it.
          const disabled = readOnly || item.hasField || item.locked || item.isDerived;
          const labelClass = item.done
            ? styles.itemLabelDone
            : item.locked
              ? styles.itemLabelLocked
              : styles.itemLabelActive;

          return (
            <div key={item.index} className={styles.item}>
              <div className={styles.itemRow}>
                <Checkbox
                  checked={item.done}
                  disabled={disabled}
                  onChange={disabled ? undefined : () => onToggleItem(item.index, !item.done)}
                  tone={item.done ? 'success' : 'brand'}
                  aria-label={item.label}
                />
                <span className={`${styles.itemLabel} ${labelClass}`}>{item.label}</span>
              </div>
              {item.hasField && item.valueKind === 'time' && (
                <ChecklistTimeInput
                  value={item.fieldValue}
                  disabled={readOnly || item.locked}
                  onCommit={(newValue) => onFieldChange(item.index, newValue)}
                />
              )}
              {item.hasField && item.valueKind !== 'time' && (
                <ChecklistFieldInput
                  value={item.fieldValue}
                  isPassword={item.fieldIsPassword}
                  disabled={readOnly || item.locked}
                  onCommit={(newValue) => onFieldChange(item.index, newValue)}
                />
              )}
              {item.returnRequirement && (
                <TerminalReturnAction
                  item={item}
                  readOnly={readOnly}
                  onUpdateCaseInfo={onUpdateCaseInfo}
                />
              )}
              {!item.hasField && item.requiredCaseFields && item.requiredCaseFields.length > 0 && (
                <RequiredCaseFieldsGroup
                  item={item}
                  disabled={item.locked}
                  onSaveCertifierName={onSaveCertifierName}
                  onSaveCertifierPhone={onSaveCertifierPhone}
                  onUpdateCaseInfo={onUpdateCaseInfo}
                  contactRestriction={contactRestriction}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "Family picked up ashes" fix (2026-10).
 *
 * THE BUG THIS SOLVES. The terminal stage's return-of-remains item is a
 * read-only, derived indicator: its `done` comes from the structured
 * release record (`returnMethod` + `pickupStatus`/`shippingDeliveryStatus`,
 * see domain/cases/returnMethod.ts), never from `checklistState`. That is
 * correct and is kept exactly as it is — it stops the checkbox and the
 * release record becoming two signals that can contradict each other.
 *
 * What was missing was a door. Staff finished "Ready for Pickup / Contact
 * Family", landed on a single greyed-out "Family picked up ashes" checkbox,
 * and had nothing to click: the only control that actually completes it is
 * a select labelled "Cremated Remains" on a different card, which doesn't
 * say it is the final workflow step and isn't rendered at all while
 * `returnMethod` is still `'undecided'`. The item looked broken.
 *
 * This renders the release record directly beneath the item, and — when it
 * is not yet recorded — a button to record it. It writes the SAME fields
 * through the SAME case PATCH as the Case Information card, so
 * `assertValidPickupReleasePatch` (domain/cases/pickupRelease.ts) applies
 * unchanged at both persistence chokepoints. Crucially the status and its
 * documentation go out in ONE patch, so a release can never be persisted
 * without a Released To and a valid Released Date — the documentation is
 * required by the dialog's own Save button as well, rather than being
 * enforced only by an error the server returns afterwards.
 *
 * It never writes `checklistState` for this item, never marks the item
 * done directly, and adds no second completion path: recording the release
 * is the only thing it does, and the item's done state continues to be
 * derived from that record alone.
 */
function TerminalReturnAction({
  item,
  readOnly,
  onUpdateCaseInfo,
}: {
  item: ChecklistItemViewModel;
  readOnly: boolean;
  onUpdateCaseInfo?: (patch: CaseUpdate) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const record = item.returnRequirement;
  if (!record) return null;

  const canEdit = !readOnly && Boolean(onUpdateCaseInfo);

  // Undecided: the return method genuinely isn't known yet, and inventing
  // a "mark complete anyway" button here would record a release that never
  // happened. Say what is actually needed instead of showing a dead
  // control — the same reasoning that keeps 'undecided' permanently
  // incomplete in isTerminalReturnRequirementComplete.
  if (record.returnMethod === 'undecided') {
    return (
      <p className={styles.terminalHint}>
        Set <b>Return method</b> in Case Information to Pickup or Shipping to record how the cremated
        remains were returned. This step completes once that is recorded.
      </p>
    );
  }

  if (record.returnMethod === 'shipping') {
    return item.done ? (
      <p className={styles.terminalRecord}>
        Delivery confirmed{record.shippingDeliveredAt ? ` on ${record.shippingDeliveredAt}` : ''}.
      </p>
    ) : (
      <p className={styles.terminalHint}>
        This case is being shipped. It completes once <b>Delivery status</b> in Case Information is
        set to Delivered.
      </p>
    );
  }

  // Pickup.
  return (
    <>
      {item.done ? (
        <p className={styles.terminalRecord}>
          Released to <b>{record.pickupReleasedTo}</b>
          {record.pickupReleasedAt ? ` on ${record.pickupReleasedAt}` : ''}.
          {canEdit && (
            <>
              {' '}
              <button type="button" className={styles.terminalLinkButton} onClick={() => setDialogOpen(true)}>
                Correct this record
              </button>
            </>
          )}
        </p>
      ) : (
        <div className={styles.terminalActionRow}>
          <button
            type="button"
            className={styles.terminalActionButton}
            disabled={!canEdit}
            onClick={() => setDialogOpen(true)}
          >
            Record family pickup
          </button>
          <span className={styles.terminalHintInline}>Requires who collected the remains and the date.</span>
        </div>
      )}

      <RecordPickupDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initialReleasedTo={record.pickupReleasedTo}
        initialReleasedAt={record.pickupReleasedAt}
        initialNote={record.pickupNote}
        onSave={(patch) => {
          setDialogOpen(false);
          onUpdateCaseInfo?.(patch);
        }}
      />
    </>
  );
}

/**
 * Collects the release documentation and sends it with `pickupStatus` in a
 * single patch. Save stays disabled until both required fields are valid
 * per `isValidPickupReleaseDetail` — the same predicate the server-side
 * invariant uses — so the UI cannot produce a request the server would
 * reject, and no partial release is ever persisted.
 */
function RecordPickupDialog({
  open,
  onClose,
  initialReleasedTo,
  initialReleasedAt,
  initialNote,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initialReleasedTo: string | null;
  initialReleasedAt: string | null;
  initialNote: string | null;
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
    setReleasedAt(initialReleasedAt ?? '');
    setNote(initialNote ?? '');
  }, [open, initialReleasedTo, initialReleasedAt, initialNote]);

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
