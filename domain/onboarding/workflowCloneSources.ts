import type { ChecklistItemTemplate, IntakeFieldTemplate, IntakeTemplate, StageTemplate } from '../../types/workflowTemplate';
import { MINIMAL_WORKFLOW, STARTER_WORKFLOW, type StarterWorkflowContent } from './starterWorkflow';

/**
 * Workflow cloning (2026-11, multi-tenant safety). What onboarding's
 * `clone_existing` may copy, and exactly which parts of it.
 *
 * Sources: a PLATFORM template registered here in code (approved by being
 * shipped with SOLIS — no tenant owns it), or a template the organization
 * being set up already owns. Another funeral home's template is never a
 * source: it is refused exactly like a template that does not exist, so a
 * guessed id reveals nothing.
 *
 * Structure only: every copied field is listed below (an allowlist). Never
 * copied: integration ids (JotForm bindings), default values, payment
 * amounts/descriptions, and anything a future field adds until it is
 * reviewed and listed here. Templates hold no staff, cases or credentials;
 * the allowlist keeps it that way if one ever does.
 */

export type PlatformWorkflowTemplate = { id: string; name: string; content: StarterWorkflowContent };

export const PLATFORM_WORKFLOW_TEMPLATES: readonly PlatformWorkflowTemplate[] = [
  { id: 'platform-standard-cremation', name: 'Standard Cremation (SOLIS)', content: STARTER_WORKFLOW },
  { id: 'platform-minimal', name: 'Minimal (SOLIS)', content: MINIMAL_WORKFLOW },
];

export function platformWorkflowTemplate(id: string): PlatformWorkflowTemplate | null {
  return PLATFORM_WORKFLOW_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Same answer for "no such template" and "another organization's template". */
export class WorkflowCloneSourceNotFoundError extends Error {
  constructor(sourceTemplateId: string) {
    super(`Source template "${sourceTemplateId}" was not found or has no versions.`);
    this.name = 'WorkflowCloneSourceNotFoundError';
  }
}

type Picked<T, K extends keyof T> = Pick<T, K>;

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Picked<T, K> {
  const out = {} as Picked<T, K>;
  for (const key of keys) if (source[key] !== undefined) out[key] = structuredClone(source[key]);
  return out;
}

const STAGE_FIELDS = ['rawStage', 'displayStage', 'label', 'isAttentionStage', 'slaTargetDays', 'stageKey'] as const satisfies readonly (keyof StageTemplate)[];
const CHECKLIST_ITEM_FIELDS = ['index', 'label', 'hasField', 'isPasswordField', 'requiredCaseFields', 'valueKind', 'stepId'] as const satisfies readonly (keyof ChecklistItemTemplate)[];
const INTAKE_FIELD_FIELDS = [
  'key', 'label', 'placeholder', 'password', 'checklistItemIndex', 'mapsToCaseField', 'fieldType', 'required',
  'displayOrder', 'uppercase', 'masked', 'multiline', 'validationType', 'options', 'paymentPurpose',
] as const satisfies readonly (keyof IntakeFieldTemplate)[];

/** The workflow's structure, rebuilt field by field from the allowlist — a
    new object graph sharing nothing with the source. */
export function workflowStructureForClone(source: StarterWorkflowContent): StarterWorkflowContent {
  const stages: StageTemplate[] = source.stages.map((stage) => ({
    ...(pick(stage, STAGE_FIELDS) as Omit<StageTemplate, 'checklist'>),
    checklist: { items: stage.checklist.items.map((item) => pick(item, CHECKLIST_ITEM_FIELDS) as ChecklistItemTemplate) },
  }));
  const intake: IntakeTemplate = {
    sections: source.intake.sections.map((section) => ({
      key: section.key,
      label: section.label,
      fields: section.fields.map((field) => pick(field, INTAKE_FIELD_FIELDS) as IntakeFieldTemplate),
    })),
  };
  return { caseTypes: [...source.caseTypes], stages, intake };
}
