import { useEffect, useState, type KeyboardEvent } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextField } from '@/components/ui/TextField';
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

export function ChecklistCard({
  checklist,
  viewingStageLabel,
  onBackToCurrentStage,
  onToggleItem,
  onFieldChange,
}: {
  checklist: ChecklistItemViewModel[];
  viewingStageLabel: string | null;
  onBackToCurrentStage: () => void;
  onToggleItem: (index: number, newDone: boolean) => void;
  onFieldChange: (index: number, value: string) => void;
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
              {item.hasField && (
                <ChecklistFieldInput
                  value={item.fieldValue}
                  isPassword={item.fieldIsPassword}
                  disabled={readOnly || item.locked}
                  onCommit={(newValue) => onFieldChange(item.index, newValue)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
