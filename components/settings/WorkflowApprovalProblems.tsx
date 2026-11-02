'use client';

import type { StageTemplate, WorkflowCompletionPolicy, WorkflowComposition, WorkflowTemplate, WorkflowVersionSource } from '@/types/workflowTemplate';
import type { WorkflowValidationProblem } from '@/domain/workflow/templateValidation';
import { useWorkflowApprovalProblems } from '@/hooks/useWorkflowApprovalProblems';
import styles from './WorkflowEditor.module.css';

export function ProblemList({ problems, testId }: { problems: readonly WorkflowValidationProblem[] | readonly string[]; testId?: string }) {
  return (
    <ul className={styles.problemList} data-testid={testId}>
      {problems.map((problem, i) => (
        <li key={i}>{typeof problem === 'string' ? problem : problem.message}</li>
      ))}
    </ul>
  );
}

/**
 * Workflow template editor (2026-10). "Before this can be approved" for
 * the editor's unsaved draft — informational (a draft may still be
 * saved); the same rules block the approve route.
 */
export function DraftApprovalReadiness({
  template,
  stages,
  serviceTypeCodes,
  completionPolicy,
  derivedFrom,
  composition,
}: {
  template: WorkflowTemplate;
  stages: StageTemplate[];
  serviceTypeCodes: string[] | undefined;
  completionPolicy?: WorkflowCompletionPolicy | null;
  derivedFrom?: WorkflowVersionSource | null;
  composition?: WorkflowComposition | null;
}) {
  const problems = useWorkflowApprovalProblems(template, stages, serviceTypeCodes, { completionPolicy, derivedFrom, composition });
  if (problems.length === 0) {
    return (
      <p className={styles.readyNote} data-testid="workflow-draft-ready">
        Complete — meets every approval rule.
      </p>
    );
  }
  return (
    <div className={styles.approvalProblems} role="status" data-testid="workflow-draft-approval-problems">
      <div className={styles.approvalProblemsTitle}>Before a version like this can be approved</div>
      <ProblemList problems={problems} />
    </div>
  );
}

/**
 * One draft version's "Approve version N" control in the version history:
 * disabled, with the reasons listed, while the version is incomplete
 * (the approve route would refuse it with 422 anyway).
 */
export function VersionApproveControl({
  template,
  version,
  disabled,
  onApprove,
}: {
  template: WorkflowTemplate;
  version: WorkflowTemplate['versions'][number];
  disabled: boolean;
  onApprove: () => void;
}) {
  const problems = useWorkflowApprovalProblems(template, version.stages, version.serviceTypeCodes, {
    completionPolicy: version.completionPolicy ?? null,
    derivedFrom: version.derivedFrom ?? null,
    composition: version.composition ?? null,
  });
  return (
    <>
      <button
        type="button"
        className="sx-btn sx-btn-ghost"
        onClick={onApprove}
        disabled={disabled || problems.length > 0}
        title={problems.length > 0 ? 'This version is incomplete — see the problems listed.' : undefined}
      >
        Approve version {version.version}
      </button>
      {problems.length > 0 && (
        <div className={styles.versionProblems} data-testid={`workflow-version-problems-${version.version}`}>
          Cannot be approved yet:
          <ProblemList problems={problems} />
        </div>
      )}
    </>
  );
}
