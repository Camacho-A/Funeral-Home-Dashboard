'use client';

import { useState } from 'react';
import { StageStepper } from '@/components/case/StageStepper';
import { displayStagesInOrder } from '@/domain/workflow/resolveStages';
import { presentedStages } from '@/domain/organization/workflowStagePresentation';
import { formatSlaTarget } from '@/domain/cases/sla';
import { REQUIRED_CASE_FIELD_OPTIONS } from '@/domain/workflow/templateValidation';
import { describeCompletionPolicy } from '@/domain/workflow/completionPolicy';
import type { ChecklistItemTemplate, StageTemplate, WorkflowCompletionPolicy } from '@/types/workflowTemplate';
import styles from './WorkflowEditor.module.css';

function itemHints(item: ChecklistItemTemplate): string[] {
  const hints: string[] = [];
  if (item.requiredCaseFields) {
    const names = item.requiredCaseFields.map((field) => REQUIRED_CASE_FIELD_OPTIONS.find((o) => o.field === field)?.label ?? field);
    hints.push(`Completed from case information${names.length ? `: ${names.join(', ')}` : ''}`);
  } else if (item.hasField) {
    hints.push(item.valueKind === 'time' ? 'Entered value — 12-hour time picker' : 'Entered value');
  } else {
    hints.push('Checkbox');
  }
  if (item.isPasswordField) hints.push('masked');
  return hints;
}

/**
 * Workflow template editor (2026-10). A read-only preview of the workflow
 * being edited, presented the way staff will meet it on a case: the same
 * StageStepper Case Detail uses, with the organization's own stage
 * presentation applied (domain/organization/workflowStagePresentation.ts —
 * Manors' combined intake label, identity for everyone else), and each
 * stage's checklist in order. Nothing here can be edited or checked off.
 * The preview reflects the unsaved draft, so an administrator can review
 * it before saving or approving.
 *
 * Service-specific completion (2026-10): given a `completionPolicy`, the
 * preview also states how a case of this service is completed and marks
 * the required final items where they appear.
 */
export function WorkflowPreview({
  organizationId,
  stages,
  completionPolicy,
}: {
  organizationId: string;
  stages: StageTemplate[];
  completionPolicy?: WorkflowCompletionPolicy | null;
}) {
  const [selected, setSelected] = useState(0);
  const snapshot = { workflowTemplateId: 'preview', workflowTemplateVersion: 0, stages, intake: { sections: [] } };
  const canonical = displayStagesInOrder(snapshot);
  const presented = presentedStages(organizationId, canonical.map((stage) => stage.label));
  const current = Math.min(selected, Math.max(presented.length - 1, 0));
  const shown = (presented[current]?.canonicalDisplayStages ?? []).map((ds) => canonical.find((stage) => stage.displayStage === ds)!).filter(Boolean);

  if (canonical.length === 0) return <p className={styles.mutedNote}>This workflow has no stages yet.</p>;

  return (
    <div className={styles.preview} data-testid="workflow-preview" aria-label="Workflow preview">
      <StageStepper
        stages={presented.map((stage, index) => ({ label: stage.label, done: false, current: index === current, viewable: true }))}
        onStepClick={setSelected}
      />
      {shown.map((stage) => (
        <div key={stage.displayStage} className={styles.previewStage}>
          <div className={styles.previewStageTitle}>
            {stage.label}
            <span className={styles.mutedNote}>
              {' '}
              · SLA {formatSlaTarget(stage.slaTargetDays)}
              {stage.isAttentionStage ? ' · needs-attention stage' : ''}
            </span>
          </div>
          {stage.checklist.items.length === 0 ? (
            <p className={styles.mutedNote}>No checklist items.</p>
          ) : (
            <ol className={styles.previewItems}>
              {stage.checklist.items.map((item) => (
                <li key={item.index} className={styles.previewItem}>
                  <span className={styles.previewBox} aria-hidden="true" />
                  <span>{item.label}</span>
                  <span className={styles.mutedNote}> — {itemHints(item).join(', ')}</span>
                  {completionPolicy?.requiredFinalItems.some((ref) => ref.displayStage === stage.displayStage && ref.index === item.index && ref.label === item.label) && (
                    <span className={styles.mutedNote}> · required to complete a case</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
      {completionPolicy && (
        <div className={styles.previewStage} data-testid="workflow-preview-completion">
          <div className={styles.previewStageTitle}>How a case is completed</div>
          <ul className={styles.previewItems}>
            {describeCompletionPolicy(completionPolicy).map((line) => (
              <li key={line} className={styles.previewItem}>
                {line}
              </li>
            ))}
          </ul>
          {completionPolicy.note && <p className={styles.mutedNote}>{completionPolicy.note}</p>}
        </div>
      )}
    </div>
  );
}
