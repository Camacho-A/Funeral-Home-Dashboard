'use client';

import { useEffect, useState } from 'react';
import { useWorkflowTemplate } from '@/hooks/useWorkflowTemplate';
import { useCreateWorkflowVersion } from '@/hooks/useCreateWorkflowVersion';
import {
  moveStage,
  validateStageSequencing,
  moveIntakeField,
  validateIntakeFields,
} from '@/domain/workflow/editing';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import type { IntakeFieldTemplate, IntakeFieldType, IntakeTemplate, StageTemplate } from '@/types/workflowTemplate';
import styles from './WorkflowEditor.module.css';

const FIELD_TYPE_OPTIONS: { value: IntakeFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'select', label: 'Select' },
  { value: 'creditCard', label: 'Credit Card' },
  { value: 'expiration', label: 'Expiration' },
  { value: 'cvv', label: 'CVV' },
];

const VALIDATION_TYPE_OPTIONS = [
  'none',
  'email',
  'phone',
  'date',
  'zip',
  'numeric',
  'currency',
  'creditCard',
  'expiration',
  'time',
] as const;

function generateUniqueFieldKey(intake: IntakeTemplate): string {
  const existingKeys = new Set(intake.sections.flatMap((section) => section.fields.map((field) => field.key)));
  let n = intake.sections.reduce((total, section) => total + section.fields.length, 0) + 1;
  let candidate = `custom-field-${n}`;
  while (existingKeys.has(candidate)) {
    n += 1;
    candidate = `custom-field-${n}`;
  }
  return candidate;
}

/**
 * Phase 19 (Configurable Intake Form Builder). Per the "Case Mapping"
 * requirement — a field with no `mapsToCaseField` must still persist via
 * "the existing workflow/checklist/intake structure," i.e.
 * Case.fieldValues[checklistItemIndex] (domain/workflow/resolveIntake.ts's
 * buildIntakeFieldValues) — a newly-added field needs a checklistItemIndex
 * from the moment it's created, or its value would be silently discarded
 * on every case creation with no persistence path at all (caught during
 * this phase's own live manual verification, not hypothetical). Picks the
 * lowest integer not already used by *any* field's checklistItemIndex
 * across the whole intake, so it can never collide with (and therefore
 * never silently combine into) an existing field's stored value.
 */
function nextAvailableChecklistItemIndex(intake: IntakeTemplate): number {
  const usedIndexes = intake.sections.flatMap((section) =>
    section.fields.map((field) => field.checklistItemIndex).filter((index): index is number => index != null),
  );
  return usedIndexes.length === 0 ? 0 : Math.max(...usedIndexes) + 1;
}

/**
 * Phase 18 (Workflow Management) / Phase 19 (Configurable Intake Form
 * Builder). Views the selected template's version history and lets an
 * admin edit its latest version's stages (name, SLA target, attention
 * flag, checklist item labels, display order) and — new in Phase 19 — its
 * intake fields (add/edit/delete/reorder, field type, required,
 * placeholder, uppercase, masked, validation, select options) before
 * saving, which always creates one brand-new WorkflowTemplateVersion
 * covering both together (useCreateWorkflowVersion -> POST .../versions),
 * never touching a historical one. Adding/removing stages or checklist
 * items, and editing intake sections themselves (only fields within an
 * existing section), the template's own name/enabled flag, and caseTypes
 * are out of scope — see docs/adr/ADR-019-workflow-management.md and
 * docs/adr/ADR-020-configurable-intake-form-builder.md.
 *
 * `draftStages`/`draftIntake` are local, fully-detached working copies
 * (structuredClone) of the latest version's content — nothing here mutates
 * the query cache until a save actually succeeds, matching the read-only
 * guarantee every other consumer of WorkflowTemplate/CaseWorkflowSnapshot
 * already relies on.
 */
export function WorkflowEditor({ templateId }: { templateId: string }) {
  const { data: template, isPending } = useWorkflowTemplate(templateId);
  const createVersion = useCreateWorkflowVersion(templateId);
  const [draftStages, setDraftStages] = useState<StageTemplate[] | null>(null);
  const [draftIntake, setDraftIntake] = useState<IntakeTemplate | null>(null);

  const latestVersion = template?.versions[template.versions.length - 1];

  useEffect(() => {
    if (latestVersion) {
      setDraftStages(structuredClone(latestVersion.stages));
      setDraftIntake(structuredClone(latestVersion.intake));
    }
    // Only re-sync when a save actually lands a new version number — never
    // while the admin has unsaved local edits open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestVersion?.version]);

  if (isPending || !template || !draftStages || !draftIntake || !latestVersion) {
    return <p className={styles.loading}>Loading workflow…</p>;
  }

  // Rebound to plain consts so the narrowed (non-null) types survive into
  // the closures below — TypeScript doesn't carry a guard's narrowing of an
  // outer variable into a nested function declaration.
  const stages = draftStages;
  const intake = draftIntake;
  const version = latestVersion;

  const isDirty =
    JSON.stringify(stages) !== JSON.stringify(version.stages) ||
    JSON.stringify(intake) !== JSON.stringify(version.intake);
  const validationErrors = [...validateStageSequencing(stages), ...validateIntakeFields(intake)];

  function updateStage(index: number, patch: Partial<StageTemplate>) {
    setDraftStages((prev) => prev!.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)));
  }

  function updateChecklistItemLabel(stageIndex: number, itemIndex: number, label: string) {
    setDraftStages((prev) =>
      prev!.map((stage, i) =>
        i !== stageIndex
          ? stage
          : {
              ...stage,
              checklist: {
                items: stage.checklist.items.map((item, ii) => (ii === itemIndex ? { ...item, label } : item)),
              },
            },
      ),
    );
  }

  function move(index: number, direction: 'up' | 'down') {
    setDraftStages((prev) => moveStage(prev!, index, direction));
  }

  function updateIntakeField(sectionIndex: number, fieldIndex: number, patch: Partial<IntakeFieldTemplate>) {
    setDraftIntake((prev) => ({
      sections: prev!.sections.map((section, si) =>
        si !== sectionIndex
          ? section
          : { ...section, fields: section.fields.map((field, fi) => (fi === fieldIndex ? { ...field, ...patch } : field)) },
      ),
    }));
  }

  function addIntakeField(sectionIndex: number) {
    setDraftIntake((prev) => {
      const key = generateUniqueFieldKey(prev!);
      const checklistItemIndex = nextAvailableChecklistItemIndex(prev!);
      const newField: IntakeFieldTemplate = { key, label: 'New field', fieldType: 'text', checklistItemIndex };
      return {
        sections: prev!.sections.map((section, si) =>
          si !== sectionIndex ? section : { ...section, fields: [...section.fields, newField] },
        ),
      };
    });
  }

  function deleteIntakeField(sectionIndex: number, fieldIndex: number) {
    setDraftIntake((prev) => ({
      sections: prev!.sections.map((section, si) =>
        si !== sectionIndex ? section : { ...section, fields: section.fields.filter((_, fi) => fi !== fieldIndex) },
      ),
    }));
  }

  function moveField(sectionIndex: number, fieldIndex: number, direction: 'up' | 'down') {
    setDraftIntake((prev) => ({
      sections: prev!.sections.map((section, si) =>
        si !== sectionIndex ? section : { ...section, fields: moveIntakeField(section.fields, fieldIndex, direction) },
      ),
    }));
  }

  function handleDiscard() {
    setDraftStages(structuredClone(version.stages));
    setDraftIntake(structuredClone(version.intake));
  }

  function handleSave() {
    if (validationErrors.length > 0) return;
    createVersion.mutate({ stages, intake });
  }

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <h2 className={styles.templateName}>{template.name}</h2>
        <div className={styles.versionBadge}>Version {latestVersion.version}</div>
      </div>

      <div className={styles.versionHistory}>
        <div className={styles.sectionLabel}>Version history</div>
        {[...template.versions].reverse().map((v) => (
          <div key={v.version} className={styles.versionRow}>
            <span>Version {v.version}</span>
            <span className={styles.versionDate}>{new Date(v.createdAt).toLocaleDateString()}</span>
            {v.version === latestVersion.version && <span className={styles.currentBadge}>Current</span>}
          </div>
        ))}
      </div>

      <div className={styles.stages}>
        {draftStages.map((stage, index) => (
          <div key={index} className={styles.stageCard}>
            <div className={styles.stageHeader}>
              <TextField
                className={styles.stageLabelInput}
                value={stage.label}
                onChange={(e) => updateStage(index, { label: e.target.value })}
                aria-label={`Stage ${index + 1} name`}
              />
              <div className={styles.moveButtons}>
                <button
                  type="button"
                  onClick={() => move(index, 'up')}
                  disabled={index === 0}
                  aria-label={`Move "${stage.label}" up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 'down')}
                  disabled={index === draftStages.length - 1}
                  aria-label={`Move "${stage.label}" down`}
                >
                  ↓
                </button>
              </div>
            </div>

            <div className={styles.stageFields}>
              <label className={styles.slaField}>
                SLA target (days)
                <TextField
                  type="number"
                  min={0}
                  value={stage.slaTargetDays ?? ''}
                  onChange={(e) =>
                    updateStage(index, { slaTargetDays: e.target.value === '' ? null : Number(e.target.value) })
                  }
                />
              </label>
              <div
                className={styles.attentionField}
                onClick={() => updateStage(index, { isAttentionStage: !stage.isAttentionStage })}
              >
                <Checkbox
                  checked={Boolean(stage.isAttentionStage)}
                  onChange={() => updateStage(index, { isAttentionStage: !stage.isAttentionStage })}
                  aria-label={`"${stage.label}" is an attention stage`}
                />
                <span>Attention stage</span>
              </div>
            </div>

            <div className={styles.checklist}>
              <div className={styles.sectionLabel}>Checklist items</div>
              {stage.checklist.items.map((item, itemIndex) => (
                <TextField
                  key={itemIndex}
                  className={styles.checklistItemInput}
                  value={item.label}
                  onChange={(e) => updateChecklistItemLabel(index, itemIndex, e.target.value)}
                  aria-label={`"${stage.label}" checklist item ${itemIndex + 1}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.intakeEditor}>
        <div className={styles.sectionLabel}>Intake form fields</div>
        {draftIntake.sections.map((section, sectionIndex) => (
          <div key={section.key} className={styles.intakeSection}>
            <div className={styles.intakeSectionLabel}>{section.label}</div>
            {section.fields.map((field, fieldIndex) => (
              <div key={field.key} className={styles.intakeFieldRow}>
                <div className={styles.intakeFieldRowTop}>
                  <TextField
                    className={styles.intakeFieldLabelInput}
                    value={field.label}
                    onChange={(e) => updateIntakeField(sectionIndex, fieldIndex, { label: e.target.value })}
                    aria-label={`Intake field ${fieldIndex + 1} label in "${section.label}"`}
                  />
                  <SelectField
                    value={field.fieldType ?? 'text'}
                    onChange={(e) =>
                      updateIntakeField(sectionIndex, fieldIndex, { fieldType: e.target.value as IntakeFieldType })
                    }
                    aria-label={`"${field.label}" field type`}
                  >
                    {FIELD_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </SelectField>
                  <div className={styles.moveButtons}>
                    <button
                      type="button"
                      onClick={() => moveField(sectionIndex, fieldIndex, 'up')}
                      disabled={fieldIndex === 0}
                      aria-label={`Move "${field.label}" up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveField(sectionIndex, fieldIndex, 'down')}
                      disabled={fieldIndex === section.fields.length - 1}
                      aria-label={`Move "${field.label}" down`}
                    >
                      ↓
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.deleteFieldButton}
                    onClick={() => deleteIntakeField(sectionIndex, fieldIndex)}
                    aria-label={`Delete "${field.label}"`}
                  >
                    Delete
                  </button>
                </div>

                <div className={styles.intakeFieldRowBottom}>
                  <TextField
                    value={field.placeholder ?? ''}
                    onChange={(e) => updateIntakeField(sectionIndex, fieldIndex, { placeholder: e.target.value })}
                    placeholder="Placeholder text"
                    aria-label={`"${field.label}" placeholder`}
                  />
                  <SelectField
                    value={field.validationType ?? 'none'}
                    onChange={(e) =>
                      updateIntakeField(sectionIndex, fieldIndex, {
                        validationType: e.target.value as IntakeFieldTemplate['validationType'],
                      })
                    }
                    aria-label={`"${field.label}" validation`}
                  >
                    {VALIDATION_TYPE_OPTIONS.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </SelectField>
                  <div
                    className={styles.intakeFieldToggle}
                    onClick={() => updateIntakeField(sectionIndex, fieldIndex, { required: !field.required })}
                  >
                    <Checkbox
                      checked={Boolean(field.required)}
                      onChange={() => updateIntakeField(sectionIndex, fieldIndex, { required: !field.required })}
                      aria-label={`"${field.label}" is required`}
                    />
                    <span>Required</span>
                  </div>
                  <div
                    className={styles.intakeFieldToggle}
                    onClick={() => updateIntakeField(sectionIndex, fieldIndex, { uppercase: !field.uppercase })}
                  >
                    <Checkbox
                      checked={Boolean(field.uppercase)}
                      onChange={() => updateIntakeField(sectionIndex, fieldIndex, { uppercase: !field.uppercase })}
                      aria-label={`"${field.label}" uppercases as typed`}
                    />
                    <span>Uppercase</span>
                  </div>
                  <div
                    className={styles.intakeFieldToggle}
                    onClick={() =>
                      updateIntakeField(sectionIndex, fieldIndex, { masked: !(field.masked ?? field.password) })
                    }
                  >
                    <Checkbox
                      checked={Boolean(field.masked ?? field.password)}
                      onChange={() =>
                        updateIntakeField(sectionIndex, fieldIndex, { masked: !(field.masked ?? field.password) })
                      }
                      aria-label={`"${field.label}" is masked`}
                    />
                    <span>Masked</span>
                  </div>
                </div>

                {field.fieldType === 'select' && (
                  <TextField
                    className={styles.intakeFieldOptionsInput}
                    value={(field.options ?? []).join(', ')}
                    onChange={(e) =>
                      updateIntakeField(sectionIndex, fieldIndex, {
                        options: e.target.value.split(',').map((opt) => opt.trim()).filter(Boolean),
                      })
                    }
                    placeholder="Comma-separated options"
                    aria-label={`"${field.label}" options`}
                  />
                )}
              </div>
            ))}
            <Button variant="secondary" onClick={() => addIntakeField(sectionIndex)}>
              Add field
            </Button>
          </div>
        ))}
      </div>

      {isDirty && validationErrors.length > 0 && (
        <div className={styles.saveError} role="alert">
          {validationErrors[0]}
        </div>
      )}
      {createVersion.isError && (
        <div className={styles.saveError} role="alert">
          {(createVersion.error as Error).message}
        </div>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={handleDiscard} disabled={!isDirty || createVersion.isPending}>
          Discard changes
        </Button>
        <Button
          onClick={handleSave}
          disabled={!isDirty || validationErrors.length > 0 || createVersion.isPending}
        >
          {createVersion.isPending ? 'Saving…' : 'Save as new version'}
        </Button>
      </div>
    </div>
  );
}
