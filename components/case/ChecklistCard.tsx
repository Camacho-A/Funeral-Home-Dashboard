import { useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { splitMilitaryTimeToTwelveHourParts, combineTwelveHourTimeParts, isValidEmail } from '@/utils/inputMask';
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
}: {
  item: ChecklistItemViewModel;
  disabled: boolean;
  onSaveCertifierName?: (value: string | null) => void;
  onSaveCertifierPhone?: (value: string | null) => void;
  onUpdateCaseInfo?: (patch: Record<string, string | null>) => void;
}) {
  const fields = item.requiredCaseFields ?? [];
  const values = item.requiredCaseFieldValues ?? {};

  function saveField(field: string, value: string | null) {
    if (field === 'certifierName') onSaveCertifierName?.(value);
    else if (field === 'certifierPhone') onSaveCertifierPhone?.(value);
    else onUpdateCaseInfo?.({ [field]: value });
  }

  return (
    <div className={styles.requiredFieldsGroup}>
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
  onUpdateCaseInfo?: (patch: Record<string, string | null>) => void;
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
              {!item.hasField && item.requiredCaseFields && item.requiredCaseFields.length > 0 && (
                <RequiredCaseFieldsGroup
                  item={item}
                  disabled={item.locked}
                  onSaveCertifierName={onSaveCertifierName}
                  onSaveCertifierPhone={onSaveCertifierPhone}
                  onUpdateCaseInfo={onUpdateCaseInfo}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
