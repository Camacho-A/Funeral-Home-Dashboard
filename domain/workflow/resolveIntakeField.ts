import type {
  IntakeFieldTemplate,
  IntakeFieldType,
  IntakeSectionTemplate,
  IntakeValidationType,
} from '../../types/workflowTemplate';

/**
 * Phase 19 (Configurable Intake Form Builder). A fully-defaulted
 * IntakeFieldTemplate — every property NewCaseModal.tsx and the Workflow
 * Editor's intake sub-editor actually branch on on is guaranteed present
 * here, so neither has to repeat "?? 'text'"-style fallback logic itself.
 * This is the single bridge between however little (or much) a stored
 * IntakeFieldTemplate specifies and what a consumer needs to render/
 * validate/mask it correctly.
 */
export type ResolvedIntakeField = {
  key: string;
  label: string;
  placeholder: string | undefined;
  checklistItemIndex: number | undefined;
  mapsToCaseField: string | undefined;
  fieldType: IntakeFieldType;
  required: boolean;
  defaultValue: string;
  displayOrder: number;
  uppercase: boolean;
  masked: boolean;
  multiline: boolean;
  validationType: IntakeValidationType;
  options: string[];
};

/**
 * Resolves one field's defaults. `indexInSection` is the field's own
 * position in its section's `fields` array — used as `displayOrder`'s
 * fallback so a pre-Phase-19 record (no `displayOrder` at all) renders in
 * exactly the order it's already stored in, unchanged.
 */
export function resolveIntakeField(field: IntakeFieldTemplate, indexInSection: number): ResolvedIntakeField {
  const fieldType = field.fieldType ?? 'text';
  return {
    key: field.key,
    label: field.label,
    placeholder: field.placeholder,
    checklistItemIndex: field.checklistItemIndex,
    mapsToCaseField: field.mapsToCaseField,
    fieldType,
    required: field.required ?? false,
    defaultValue: field.defaultValue ?? '',
    displayOrder: field.displayOrder ?? indexInSection,
    uppercase: field.uppercase ?? false,
    masked: field.masked ?? field.password ?? false,
    multiline: fieldType === 'textarea',
    // Phase 19.1 (Time Input Normalization): a fieldType of 'time' implies
    // time validation/normalization by default — an admin configuring a
    // time field shouldn't also have to separately remember to set
    // validationType — but an explicit validationType (rare) still wins.
    validationType: field.validationType ?? (fieldType === 'time' ? 'time' : 'none'),
    options: field.options ?? [],
  };
}

/**
 * Resolves and sorts an entire section's fields by displayOrder (falling
 * back to array index per resolveIntakeField above) — the order
 * NewCaseModal.tsx and the intake editor should both actually render in.
 * A stable sort, so two fields that both fall back to their own index (the
 * common pre-Phase-19 case) never reorder relative to each other.
 */
export function resolveSectionFields(section: IntakeSectionTemplate): ResolvedIntakeField[] {
  return section.fields
    .map((field, index) => resolveIntakeField(field, index))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}
