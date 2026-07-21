import type {
  WorkflowTemplate,
  WorkflowTemplateVersion,
  CaseWorkflowSnapshot,
} from '../../types/workflowTemplate';

export function latestTemplateVersion(template: WorkflowTemplate): WorkflowTemplateVersion {
  const version = template.versions[template.versions.length - 1];
  if (!version) throw new Error(`Workflow template ${template.id} has no versions`);
  return version;
}

/**
 * The actual immutability guarantee behind Case.workflowSnapshot: a deep
 * copy taken at case-creation time (structuredClone, not a shallow spread —
 * stages/checklist/intake are nested arrays of objects), so a later edit to
 * the live WorkflowTemplate (e.g. a future admin editor, not built in this
 * phase) can never retroactively change how an existing case's stages,
 * checklist, or intake fields resolve. See
 * docs/TEMPLATE_VERSIONING.md and docs/adr/ADR-006-workflow-template-architecture.md.
 */
export function buildCaseWorkflowSnapshot(
  template: WorkflowTemplate,
  version: WorkflowTemplateVersion,
): CaseWorkflowSnapshot {
  return structuredClone({
    workflowTemplateId: template.id,
    workflowTemplateVersion: version.version,
    stages: version.stages,
    intake: version.intake,
  });
}
