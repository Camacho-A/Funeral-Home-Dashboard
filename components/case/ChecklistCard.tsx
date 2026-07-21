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
          const disabled = readOnly || item.hasField || item.locked;
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
                <TextField
                  className={styles.fieldInput}
                  type={item.fieldIsPassword ? 'password' : 'text'}
                  value={item.fieldValue}
                  onChange={(e) => onFieldChange(item.index, e.target.value)}
                  disabled={readOnly || item.locked}
                  placeholder="Enter value to complete this step…"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
