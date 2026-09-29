import { useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { splitMilitaryTimeToTwelveHourParts, combineTwelveHourTimeParts } from '@/utils/inputMask';
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
 */
function ChecklistFieldInput({
  value,
  isPassword,
  disabled,
  onCommit,
}: {
  value: string;
  isPassword: boolean;
  disabled: boolean;
  onCommit: (newValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  useEffect(() => {
    if (pendingValue !== null && value === pendingValue) setPendingValue(null);
  }, [value, pendingValue]);

  const displayValue = pendingValue ?? value;

  function commit() {
    if (draft !== displayValue) {
      setPendingValue(draft);
      onCommit(draft);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(displayValue);
      setIsFocused(false);
    }
  }

  return (
    <TextField
      className={styles.fieldInput}
      type={isPassword ? 'password' : 'text'}
      value={isFocused ? draft : displayValue}
      onFocus={() => {
        setDraft(displayValue);
        setIsFocused(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        commit();
        setIsFocused(false);
      }}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      placeholder="Enter value to complete this step…"
    />
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
 * names this component actually knows how to label and save are rendered
 * at all, so an unrecognized future requiredCaseFields entry is silently
 * skipped here rather than guessed at.
 *
 * Writes go straight to the named onSave callback (which
 * hooks/useCaseMutations.ts's setCertifierName/setCertifierPhone turn
 * into a `{ certifierX: value }`-only patch, the exact same path Case
 * Information's own Certifier fields already use) — never through
 * onFieldChange/setFieldValue, so no fieldValues mirror is ever created
 * for these fields, and the legacy dcContact fieldValues entry (if any)
 * is never read or touched.
 *
 * `disabled` deliberately does NOT include the card's `readOnly` (past-
 * stage viewing) flag at the call site below — Certifier Name/Phone are
 * live Case data, not part of the frozen stage snapshot, so staff must be
 * able to complete or correct them from an earlier stage's view exactly
 * as they already can from Case Information. `item.locked` still applies
 * (always false for a past-stage item anyway — see resolveChecklist.ts).
 * Server-side Case Information edit permission remains the authoritative
 * gate, identical to every other Certifier edit path.
 */
const REQUIRED_CASE_FIELD_LABELS: Record<string, string> = {
  certifierName: 'Certifier name',
  certifierPhone: 'Certifier phone',
};

function RequiredCaseFieldsGroup({
  item,
  disabled,
  onSaveCertifierName,
  onSaveCertifierPhone,
}: {
  item: ChecklistItemViewModel;
  disabled: boolean;
  onSaveCertifierName?: (value: string | null) => void;
  onSaveCertifierPhone?: (value: string | null) => void;
}) {
  const fields = item.requiredCaseFields ?? [];
  const values = item.requiredCaseFieldValues ?? {};
  const commit = (onSave: ((value: string | null) => void) | undefined) => (newValue: string) => {
    const trimmed = newValue.trim();
    onSave?.(trimmed.length > 0 ? trimmed : null);
  };

  return (
    <div className={styles.requiredFieldsGroup}>
      {fields.includes('certifierName') && (
        <div className={styles.requiredFieldRow}>
          <span className={styles.requiredFieldLabel}>{REQUIRED_CASE_FIELD_LABELS.certifierName}</span>
          <ChecklistFieldInput
            value={values.certifierName ?? ''}
            isPassword={false}
            disabled={disabled}
            onCommit={commit(onSaveCertifierName)}
          />
        </div>
      )}
      {fields.includes('certifierPhone') && (
        <div className={styles.requiredFieldRow}>
          <span className={styles.requiredFieldLabel}>{REQUIRED_CASE_FIELD_LABELS.certifierPhone}</span>
          <ChecklistFieldInput
            value={values.certifierPhone ?? ''}
            isPassword={false}
            disabled={disabled}
            onCommit={commit(onSaveCertifierPhone)}
          />
        </div>
      )}
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
}: {
  checklist: ChecklistItemViewModel[];
  viewingStageLabel: string | null;
  onBackToCurrentStage: () => void;
  onToggleItem: (index: number, newDone: boolean) => void;
  onFieldChange: (index: number, value: string) => void;
  onSaveCertifierName?: (value: string | null) => void;
  onSaveCertifierPhone?: (value: string | null) => void;
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
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
