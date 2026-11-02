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
 * Service-specific workflows (2026-10). A version is usable for live cases
 * unless it is explicitly a draft — an absent `status` (every version that
 * predates the field) means approved, so nothing existing changes.
 */
export function isApprovedVersion(version: WorkflowTemplateVersion): boolean {
  return version.status !== 'draft';
}

/** The newest version a live case may be created from, or null when every
    version is still a draft. Used only for organizations with
    `features.workflowByServiceType`; everyone else keeps
    latestTemplateVersion. */
export function latestApprovedVersion(template: WorkflowTemplate): WorkflowTemplateVersion | null {
  for (let i = template.versions.length - 1; i >= 0; i -= 1) {
    if (isApprovedVersion(template.versions[i])) return template.versions[i];
  }
  return null;
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
  /** Service-specific workflows (2026-10). Recorded only when given, so a
      snapshot built without one is byte-identical to before. */
  serviceTypeCode?: string | null,
): CaseWorkflowSnapshot {
  // The service and composition are recorded only when present, so a case
  // created without them stores exactly the same snapshot as before.
  return structuredClone({
    workflowTemplateId: template.id,
    workflowTemplateVersion: version.version,
    stages: version.stages,
    intake: version.intake,
    ...(serviceTypeCode ? { serviceTypeCode } : {}),
    ...(version.composition ? { composition: version.composition } : {}),
    // Service-specific completion (2026-10): frozen with the stages it
    // refers to. Copied only when the version has one, so every other
    // snapshot stays byte-identical (and keeps today's completion rule).
    ...(version.completionPolicy ? { completionPolicy: version.completionPolicy } : {}),
  });
}
