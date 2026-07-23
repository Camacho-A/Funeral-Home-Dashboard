import type { IntakeFieldTemplate, IntakeTemplate, StageTemplate } from '../../types/workflowTemplate';

/**
 * Phase 18 (Workflow Management) / Phase 19 (Configurable Intake Form
 * Builder). Pure structural operations over a draft `stages`/`intake`
 * array, used by the admin editor (components/settings/) before submitting
 * an edited copy as a brand-new WorkflowTemplateVersion — never mutating a
 * historical version in place (see docs/adr/ADR-019-workflow-management.md,
 * docs/adr/ADR-020-configurable-intake-form-builder.md). These are business
 * invariants specific to Beacon's workflow model (not generic array
 * helpers), so they live in domain/, not utils/, per
 * docs/adr/ADR-004-domain-layer.md.
 */

/**
 * Swaps a stage with its up/down neighbor and renumbers every stage's
 * `rawStage`/`displayStage` sequentially from 0 — keeping
 * docs/TEMPLATE_VERSIONING.md's documented constraint ("every template's
 * raw stages must be sequential integers starting at 0 with no gaps")
 * intact automatically, rather than relying on every caller to remember it.
 * A no-op (returns the same array reference) if the move would go out of
 * bounds.
 *
 * Renumbering assigns each stage its own displayStage — a pre-existing,
 * hand-authored combined display stage (two raw stages sharing one
 * displayStage, e.g. Managed Cremations' First Call + Payment) is not
 * reproduced through a reorder. That's a deliberate scope limit: building
 * UI for "which stages should visually combine" is well beyond what this
 * phase asks for (see the ADR's "Known limitations").
 */
export function moveStage(stages: StageTemplate[], index: number, direction: 'up' | 'down'): StageTemplate[] {
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= stages.length || targetIndex < 0 || targetIndex >= stages.length) {
    return stages;
  }

  const reordered = [...stages];
  [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
  return renumberStages(reordered);
}

function renumberStages(stages: StageTemplate[]): StageTemplate[] {
  return stages.map((stage, i) => ({ ...stage, rawStage: i, displayStage: i }));
}

/**
 * Phase 19 (Configurable Intake Form Builder). Same swap-and-renumber
 * pattern as moveStage above, scoped to one intake section's fields —
 * renumbers every field's `displayOrder` sequentially from 0 afterward, so
 * the section always has a clean, gap-free order for
 * resolveIntakeField.ts's resolveSectionFields to sort by (that fallback
 * only matters pre-move; once an admin has explicitly reordered anything,
 * every field in the section gets an explicit, correct displayOrder).
 */
export function moveIntakeField(
  fields: IntakeFieldTemplate[],
  index: number,
  direction: 'up' | 'down',
): IntakeFieldTemplate[] {
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= fields.length || targetIndex < 0 || targetIndex >= fields.length) {
    return fields;
  }

  const reordered = [...fields];
  [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
  return reordered.map((field, i) => ({ ...field, displayOrder: i }));
}

/**
 * Business-rule validation for an edited stages array, run server-side
 * before it's accepted as a new version's content — distinct from
 * lib/wixWorkflowTemplateMapper.ts's validateWorkflowStagesPayload, which
 * only checks that the JSON is *shaped* like a StageTemplate[] (right
 * types, right keys). This checks that it's a *valid* one: sequential raw
 * stages starting at 0 (the same invariant moveStage's renumbering
 * maintains), sequential checklist item indices starting at 0 per stage,
 * and non-empty labels — the same "empty state considered invalid"
 * standard the New Case form and Case Information editor already apply
 * (utils/inputMask.ts, components/case/CaseInformationCard.tsx).
 */
export function validateStageSequencing(stages: StageTemplate[]): string[] {
  const errors: string[] = [];

  if (stages.length === 0) {
    errors.push('At least one stage is required.');
    return errors;
  }

  stages.forEach((stage, i) => {
    if (stage.rawStage !== i) {
      errors.push(`Stage at position ${i} has rawStage ${stage.rawStage}, expected ${i}.`);
    }
    if (!stage.label.trim()) {
      errors.push(`Stage at position ${i} must have a non-empty label.`);
    }
    if (stage.slaTargetDays !== null && stage.slaTargetDays < 0) {
      errors.push(`Stage "${stage.label}" has a negative SLA target.`);
    }

    stage.checklist.items.forEach((item, itemIndex) => {
      if (item.index !== itemIndex) {
        errors.push(
          `Checklist item at position ${itemIndex} in stage "${stage.label}" has index ${item.index}, expected ${itemIndex}.`,
        );
      }
      if (!item.label.trim()) {
        errors.push(`Checklist item ${itemIndex} in stage "${stage.label}" must have a non-empty label.`);
      }
    });
  });

  return errors;
}

const VALID_FIELD_TYPES = new Set([
  'text',
  'textarea',
  'date',
  'time',
  'phone',
  'email',
  'number',
  'currency',
  'checkbox',
  'select',
  'creditCard',
  'expiration',
  'cvv',
]);

const VALID_VALIDATION_TYPES = new Set([
  'none',
  'email',
  'phone',
  'date',
  'zip',
  'numeric',
  'currency',
  'creditCard',
  'expiration',
]);

/**
 * Phase 19 (Configurable Intake Form Builder). Business-rule validation for
 * an admin's edited `intake` structure, run server-side (alongside
 * validateStageSequencing) before it's accepted as part of a new
 * WorkflowTemplateVersion. Deliberately *not* as strict as
 * validateStageSequencing about ordering: `displayOrder` is a sort hint
 * with a per-field array-index fallback (see resolveIntakeField.ts), not a
 * structural invariant other code depends on the way rawStage's
 * no-gaps-from-zero requirement is — so this never rejects a "non-
 * sequential" displayOrder. What it does enforce: every field key is
 * globally unique (the New Case form's draft state is keyed by it — a
 * collision would silently merge two fields' values), every field has a
 * non-empty label, `fieldType`/`validationType` (when present) are one of
 * the supported values, and a 'select' field has at least one option.
 */
export function validateIntakeFields(intake: IntakeTemplate): string[] {
  const errors: string[] = [];
  const seenKeys = new Set<string>();

  intake.sections.forEach((section) => {
    section.fields.forEach((field) => {
      if (!field.key.trim()) {
        errors.push(`A field in section "${section.label}" is missing a key.`);
      } else if (seenKeys.has(field.key)) {
        errors.push(`Duplicate field key "${field.key}" — every intake field key must be unique.`);
      } else {
        seenKeys.add(field.key);
      }

      if (!field.label.trim()) {
        errors.push(`Field "${field.key}" in section "${section.label}" must have a non-empty label.`);
      }
      if (field.fieldType !== undefined && !VALID_FIELD_TYPES.has(field.fieldType)) {
        errors.push(`Field "${field.key}" has an unrecognized fieldType "${field.fieldType}".`);
      }
      if (field.validationType !== undefined && !VALID_VALIDATION_TYPES.has(field.validationType)) {
        errors.push(`Field "${field.key}" has an unrecognized validationType "${field.validationType}".`);
      }
      if (field.fieldType === 'select' && (!field.options || field.options.length === 0)) {
        errors.push(`Field "${field.key}" is a select field but has no options.`);
      }
    });
  });

  return errors;
}
