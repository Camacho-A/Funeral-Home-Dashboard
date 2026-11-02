'use client';

import { Checkbox } from '@/components/ui/Checkbox';
import { SelectField } from '@/components/ui/SelectField';
import {
  completionItemOptions,
  DEFAULT_MANUAL_COMPLETION_PERMISSION,
  MANUAL_COMPLETION_PERMISSIONS,
  sameItemRef,
  setManualCompletion,
  setRemainsReturnRequired,
  staleRequiredFinalItems,
  toggleRequiredFinalItem,
} from '@/domain/workflow/completionPolicy';
import type { ManualCompletionPermission, StageTemplate, WorkflowCompletionPolicy } from '@/types/workflowTemplate';
import styles from './WorkflowEditor.module.css';

/**
 * Service-specific completion (2026-10). Settings › Workflow Templates'
 * "Completion" section: how a case of this service is finished, saved as
 * part of the draft version (types/workflowTemplate.ts#WorkflowCompletionPolicy)
 * and validated on approval (domain/workflow/completionPolicy.ts). Only
 * shown to organizations whose versions require approval.
 *
 * - "Requires return of cremated remains" — the cremation rule (pickup
 *   released / shipment delivered). Off for burial and entombment.
 * - Required final items — chosen from THIS template's own final stage and
 *   the stage before it; nothing is offered that the template does not
 *   contain. A required item that no longer matches (moved, renamed,
 *   removed) is listed so it can be removed.
 * - Manual completion — whether staff holding an existing permission may
 *   complete a case on its final stage by hand.
 * - Archiving — whether completion archives the case.
 */
export function WorkflowCompletionEditor({
  stages,
  policy,
  onChange,
}: {
  stages: StageTemplate[];
  policy: WorkflowCompletionPolicy;
  onChange: (next: WorkflowCompletionPolicy) => void;
}) {
  const options = completionItemOptions(stages);
  const stale = staleRequiredFinalItems(policy, stages);

  return (
    <section className={styles.completionSection} aria-label="Completion" data-testid="workflow-completion-section">
      <div className={styles.sectionLabel}>Completion</div>
      <p className={styles.helpText}>
        When is a case of this service finished? A case is shown as Completed — and, if set below, archived — only once these
        requirements are met on its final stage.
      </p>
      {policy.note && (
        <p className={styles.completionNote} data-testid="workflow-completion-note">
          {policy.note}
        </p>
      )}

      <div className={styles.completionToggle}>
        <Checkbox
          checked={policy.requiresRemainsReturn}
          onChange={() => onChange(setRemainsReturnRequired(policy, !policy.requiresRemainsReturn))}
          aria-label="Requires return of cremated remains"
        />
        <span>Requires return of cremated remains (family pickup released, or shipment confirmed delivered)</span>
      </div>

      <div>
        <div className={styles.intakeSectionLabel}>Required final items</div>
        {options.length === 0 ? (
          <p className={styles.mutedNote}>The final stage and the stage before it have no checklist items yet.</p>
        ) : (
          <ul className={styles.completionItems}>
            {options.map((option) => {
              const checked = policy.requiredFinalItems.some((ref) => sameItemRef(ref, option.ref) && ref.label === option.ref.label);
              return (
                <li key={`${option.ref.displayStage}:${option.ref.index}`} className={styles.completionToggle}>
                  <Checkbox
                    checked={checked}
                    onChange={() => onChange(toggleRequiredFinalItem(policy, option.ref))}
                    aria-label={`Require "${option.ref.label}" to complete a case`}
                  />
                  <span>
                    {option.ref.label} <span className={styles.mutedNote}>— {option.stageLabel}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!policy.requiresRemainsReturn && policy.requiredFinalItems.length === 0 && (
          <p className={styles.completionNote} data-testid="workflow-completion-undefined">
            No required final items are chosen — a case of this service could never be completed, and this version cannot be approved.
          </p>
        )}
        {stale.length > 0 && (
          <ul className={styles.completionItems} data-testid="workflow-completion-stale">
            {stale.map((ref) => (
              <li key={`stale-${ref.displayStage}:${ref.index}`} className={styles.completionToggle}>
                <span className={styles.completionNote}>“{ref.label}” no longer matches an item in the final stages.</span>
                <button
                  type="button"
                  className="sx-btn sx-btn-ghost sx-btn-sm"
                  onClick={() => onChange({ ...policy, requiredFinalItems: policy.requiredFinalItems.filter((entry) => entry !== ref) })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.completionToggle}>
        <Checkbox
          checked={policy.manualCompletion.allowed}
          onChange={() => onChange(setManualCompletion(policy, { allowed: !policy.manualCompletion.allowed }))}
          aria-label="Allow manual completion"
        />
        <span>Allow staff to mark a case on its final stage completed (with a reason; recorded in the activity log)</span>
      </div>
      {policy.manualCompletion.allowed && (
        <SelectField
          className="sx-select"
          value={policy.manualCompletion.permission ?? DEFAULT_MANUAL_COMPLETION_PERMISSION}
          onChange={(e) => onChange(setManualCompletion(policy, { allowed: true, permission: e.target.value as ManualCompletionPermission }))}
          aria-label="Who may complete a case manually"
        >
          {MANUAL_COMPLETION_PERMISSIONS.map((entry) => (
            <option key={entry.permission} value={entry.permission}>
              {entry.label}
            </option>
          ))}
        </SelectField>
      )}

      <SelectField
        className="sx-select"
        value={policy.archiveEligibility}
        onChange={(e) => onChange({ ...policy, archiveEligibility: e.target.value as WorkflowCompletionPolicy['archiveEligibility'] })}
        aria-label="Archiving after completion"
      >
        <option value="on_completion">Archive a case automatically when it is completed</option>
        <option value="manual">Keep completed cases in the working lists until staff archive them</option>
      </SelectField>
    </section>
  );
}
