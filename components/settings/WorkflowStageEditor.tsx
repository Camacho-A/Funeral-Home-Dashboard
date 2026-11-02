'use client';

import { Checkbox } from '@/components/ui/Checkbox';
import { TextField } from '@/components/ui/TextField';
import { REQUIRED_CASE_FIELD_OPTIONS } from '@/domain/workflow/templateValidation';
import type { ChecklistItemPatch } from '@/domain/workflow/templateEditing';
import type { StageTemplate } from '@/types/workflowTemplate';
import styles from './WorkflowEditor.module.css';

export type WorkflowStageEditorHandlers = {
  onUpdateStage: (patch: Partial<Pick<StageTemplate, 'label' | 'slaTargetDays' | 'isAttentionStage'>>) => void;
  onMoveStage: (direction: 'up' | 'down') => void;
  onRemoveStage: () => void;
  onAddItem: () => void;
  onUpdateItem: (itemIndex: number, patch: ChecklistItemPatch) => void;
  onMoveItem: (itemIndex: number, direction: 'up' | 'down') => void;
  onRemoveItem: (itemIndex: number) => void;
};

/**
 * Workflow template editor (2026-10). One DISPLAY stage — what staff see as
 * one stepper position — of the draft being edited. `group` is every raw
 * stage sharing that display stage (two for the cremation First Call &
 * Payment stage); the card edits them as one, through
 * domain/workflow/templateEditing.ts, which keeps them identical.
 *
 * Item requirements expose exactly what the engine reads, nothing more:
 * data entry (`hasField`, first stage only — Case.fieldValues is keyed by a
 * bare index only the intake stage may own), the 12-hour time picker
 * (`valueKind: 'time'`, data-entry items only), masked entry
 * (`isPasswordField`), and completion from structured case fields
 * (`requiredCaseFields`, never together with data entry).
 */
export function WorkflowStageEditor({
  group,
  position,
  stageCount,
  canMoveUp,
  canMoveDown,
  canRemove,
  lockedReason,
  itemLockReason,
  handlers,
}: {
  group: StageTemplate[];
  position: number;
  stageCount: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  /** Why move/remove are unavailable for this stage, when they are. */
  lockedReason: string | null;
  /** Why an item may not be removed (intake fields feed it), or null. */
  itemLockReason: (itemIndex: number) => string | null;
  handlers: WorkflowStageEditorHandlers;
}) {
  const stage = group[0];
  const isIntakeStage = position === 0;
  const items = stage.checklist.items;

  return (
    <div className={styles.stageCard} data-testid={`workflow-stage-${position}`}>
      <div className={styles.stageHeader}>
        <TextField
          className={`${styles.stageLabelInput} sx-input`}
          value={stage.label}
          onChange={(e) => handlers.onUpdateStage({ label: e.target.value })}
          aria-label={`Stage ${position + 1} name`}
        />
        <div className={styles.moveButtons}>
          <button type="button" onClick={() => handlers.onMoveStage('up')} disabled={!canMoveUp} aria-label={`Move "${stage.label}" up`}>
            ↑
          </button>
          <button type="button" onClick={() => handlers.onMoveStage('down')} disabled={!canMoveDown} aria-label={`Move "${stage.label}" down`}>
            ↓
          </button>
        </div>
        <button
          type="button"
          className={styles.deleteFieldButton}
          onClick={handlers.onRemoveStage}
          disabled={!canRemove}
          title={lockedReason ?? undefined}
          aria-label={`Remove stage "${stage.label}"`}
        >
          Remove stage
        </button>
      </div>
      {(group.length > 1 || lockedReason || position === stageCount - 1) && (
        <p className={styles.helpText}>
          {group.length > 1 && `Combined stage: ${group.length} internal steps share this stage and its checklist. `}
          {position === stageCount - 1 && 'Final stage — a complete workflow ends with "Completed". '}
          {lockedReason}
        </p>
      )}

      <div className={styles.stageFields}>
        <label className={styles.slaField}>
          SLA target (days)
          <TextField
            className="sx-input"
            type="number"
            min={0}
            value={stage.slaTargetDays ?? ''}
            onChange={(e) => handlers.onUpdateStage({ slaTargetDays: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </label>
        <div className={styles.attentionField} onClick={() => handlers.onUpdateStage({ isAttentionStage: !stage.isAttentionStage })}>
          <Checkbox
            checked={Boolean(stage.isAttentionStage)}
            onChange={() => handlers.onUpdateStage({ isAttentionStage: !stage.isAttentionStage })}
            aria-label={`"${stage.label}" is an attention stage`}
          />
          <span>Attention stage</span>
        </div>
      </div>

      <div className={styles.checklist}>
        <div className={styles.sectionLabel}>Checklist items</div>
        {items.length === 0 && <p className={styles.mutedNote}>No checklist items yet.</p>}
        {items.map((item, itemIndex) => {
          const lock = itemLockReason(itemIndex);
          const usesCaseFields = item.requiredCaseFields !== undefined;
          return (
            <div key={itemIndex} className={styles.itemRow} data-testid={`workflow-item-${position}-${itemIndex}`}>
              <div className={styles.intakeFieldRowTop}>
                <TextField
                  className={`${styles.checklistItemInput} ${styles.intakeFieldLabelInput} sx-input`}
                  value={item.label}
                  onChange={(e) => handlers.onUpdateItem(itemIndex, { label: e.target.value })}
                  aria-label={`"${stage.label}" checklist item ${itemIndex + 1}`}
                />
                <div className={styles.moveButtons}>
                  <button
                    type="button"
                    onClick={() => handlers.onMoveItem(itemIndex, 'up')}
                    disabled={itemIndex === 0}
                    aria-label={`Move item ${itemIndex + 1} of "${stage.label}" up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => handlers.onMoveItem(itemIndex, 'down')}
                    disabled={itemIndex === items.length - 1}
                    aria-label={`Move item ${itemIndex + 1} of "${stage.label}" down`}
                  >
                    ↓
                  </button>
                </div>
                <button
                  type="button"
                  className={styles.deleteFieldButton}
                  onClick={() => handlers.onRemoveItem(itemIndex)}
                  disabled={lock !== null}
                  title={lock ?? undefined}
                  aria-label={`Remove item ${itemIndex + 1} from "${stage.label}"`}
                >
                  Remove
                </button>
              </div>
              <div className={styles.intakeFieldRowBottom}>
                {isIntakeStage && (
                  <div className={styles.intakeFieldToggle} onClick={() => !usesCaseFields && handlers.onUpdateItem(itemIndex, { hasField: !item.hasField, ...(item.hasField ? { valueKind: undefined } : {}) })}>
                    <Checkbox
                      checked={item.hasField}
                      disabled={usesCaseFields}
                      onChange={() => handlers.onUpdateItem(itemIndex, { hasField: !item.hasField, ...(item.hasField ? { valueKind: undefined } : {}) })}
                      aria-label={`Checklist item "${item.label}" is a data-entry item`}
                    />
                    <span>Data entry</span>
                  </div>
                )}
                {isIntakeStage && item.hasField && (
                  <div className={styles.intakeFieldToggle} onClick={() => handlers.onUpdateItem(itemIndex, { valueKind: item.valueKind === 'time' ? undefined : 'time' })}>
                    <Checkbox
                      checked={item.valueKind === 'time'}
                      onChange={() => handlers.onUpdateItem(itemIndex, { valueKind: item.valueKind === 'time' ? undefined : 'time' })}
                      aria-label={`Checklist item "${item.label}" uses the 12-hour time picker`}
                    />
                    <span>Time (12-hour AM/PM)</span>
                  </div>
                )}
                {item.hasField && (
                  <div className={styles.intakeFieldToggle} onClick={() => handlers.onUpdateItem(itemIndex, { isPasswordField: !item.isPasswordField })}>
                    <Checkbox
                      checked={Boolean(item.isPasswordField)}
                      onChange={() => handlers.onUpdateItem(itemIndex, { isPasswordField: !item.isPasswordField })}
                      aria-label={`Checklist item "${item.label}" is masked`}
                    />
                    <span>Masked</span>
                  </div>
                )}
                {!item.hasField && (
                  <div className={styles.intakeFieldToggle} onClick={() => handlers.onUpdateItem(itemIndex, { requiredCaseFields: usesCaseFields ? undefined : [] })}>
                    <Checkbox
                      checked={usesCaseFields}
                      onChange={() => handlers.onUpdateItem(itemIndex, { requiredCaseFields: usesCaseFields ? undefined : [] })}
                      aria-label={`Checklist item "${item.label}" is completed from case fields`}
                    />
                    <span>Completed from case information</span>
                  </div>
                )}
              </div>
              {usesCaseFields && (
                <div className={styles.intakeFieldRowBottom} role="group" aria-label={`Case fields for "${item.label}"`}>
                  {REQUIRED_CASE_FIELD_OPTIONS.map((option) => {
                    const fields = item.requiredCaseFields ?? [];
                    const checked = fields.includes(option.field);
                    const next = checked ? fields.filter((f) => f !== option.field) : [...fields, option.field];
                    return (
                      <div key={option.field} className={styles.intakeFieldToggle} onClick={() => handlers.onUpdateItem(itemIndex, { requiredCaseFields: next })}>
                        <Checkbox
                          size="sm"
                          checked={checked}
                          onChange={() => handlers.onUpdateItem(itemIndex, { requiredCaseFields: next })}
                          aria-label={`Checklist item "${item.label}" requires ${option.label}`}
                        />
                        <span>{option.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={handlers.onAddItem} aria-label={`Add checklist item to "${stage.label}"`}>
          + Add checklist item
        </button>
      </div>
    </div>
  );
}
