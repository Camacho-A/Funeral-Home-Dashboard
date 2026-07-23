'use client';

import { useEffect, useState } from 'react';
import { useWorkflowTemplate } from '@/hooks/useWorkflowTemplate';
import { useCreateWorkflowVersion } from '@/hooks/useCreateWorkflowVersion';
import { moveStage, validateStageSequencing } from '@/domain/workflow/editing';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextField } from '@/components/ui/TextField';
import type { StageTemplate } from '@/types/workflowTemplate';
import styles from './WorkflowEditor.module.css';

/**
 * Phase 18 (Workflow Management). Views the selected template's version
 * history and lets an admin edit its latest version's stages (name, SLA
 * target, attention flag, checklist item labels, display order) before
 * saving — which always creates a brand-new WorkflowTemplateVersion
 * (useCreateWorkflowVersion -> POST .../versions), never touching a
 * historical one. Adding/removing stages or checklist items, and editing
 * intake fields or the template's own name/enabled flag, are out of this
 * phase's scope — see docs/adr/ADR-019-workflow-management.md.
 *
 * `draftStages` is a local, fully-detached working copy (structuredClone)
 * of the latest version's stages — nothing here mutates the query cache
 * until a save actually succeeds, matching the read-only guarantee every
 * other consumer of WorkflowTemplate/CaseWorkflowSnapshot already relies on.
 */
export function WorkflowEditor({ templateId }: { templateId: string }) {
  const { data: template, isPending } = useWorkflowTemplate(templateId);
  const createVersion = useCreateWorkflowVersion(templateId);
  const [draftStages, setDraftStages] = useState<StageTemplate[] | null>(null);

  const latestVersion = template?.versions[template.versions.length - 1];

  useEffect(() => {
    if (latestVersion) setDraftStages(structuredClone(latestVersion.stages));
    // Only re-sync when a save actually lands a new version number — never
    // while the admin has unsaved local edits open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestVersion?.version]);

  if (isPending || !template || !draftStages || !latestVersion) {
    return <p className={styles.loading}>Loading workflow…</p>;
  }

  // Rebound to plain consts so the narrowed (non-null) types survive into
  // the closures below — TypeScript doesn't carry a guard's narrowing of an
  // outer variable into a nested function declaration.
  const stages = draftStages;
  const version = latestVersion;

  const isDirty = JSON.stringify(stages) !== JSON.stringify(version.stages);
  const validationErrors = validateStageSequencing(stages);

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

  function handleDiscard() {
    setDraftStages(structuredClone(version.stages));
  }

  function handleSave() {
    if (validationErrors.length > 0) return;
    createVersion.mutate(stages);
  }

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <h2 className={styles.templateName}>{template.name}</h2>
        <div className={styles.versionBadge}>Version {latestVersion.version}</div>
      </div>

      <div className={styles.versionHistory}>
        <div className={styles.sectionLabel}>Version history</div>
        {[...template.versions].reverse().map((version) => (
          <div key={version.version} className={styles.versionRow}>
            <span>Version {version.version}</span>
            <span className={styles.versionDate}>{new Date(version.createdAt).toLocaleDateString()}</span>
            {version.version === latestVersion.version && <span className={styles.currentBadge}>Current</span>}
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
