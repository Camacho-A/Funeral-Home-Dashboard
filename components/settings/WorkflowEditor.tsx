'use client';

import { useEffect, useState } from 'react';
import { useWorkflowTemplate } from '@/hooks/useWorkflowTemplate';
import { useCreateWorkflowVersion } from '@/hooks/useCreateWorkflowVersion';
import { moveIntakeField, validateIntakeFields } from '@/domain/workflow/editing';
import {
  addChecklistItem,
  addStage,
  groupStagesByDisplayStage,
  intakeFieldsLinkedToFirstStageItem,
  isFirstStageLinkedToIntake,
  itemOrderAfterMove,
  itemOrderAfterRemoval,
  moveChecklistItem,
  moveDisplayStage,
  remapIntakeAfterFirstStageChange,
  removeChecklistItem,
  removeStage,
  updateChecklistItem,
  updateStage,
  type ChecklistItemPatch,
} from '@/domain/workflow/templateEditing';
import { problemMessages, validateWorkflowStages } from '@/domain/workflow/templateValidation';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import type {
  IntakeFieldTemplate,
  IntakeFieldType,
  IntakeTemplate,
  StageTemplate,
  WorkflowApprovalAttestation,
  WorkflowCompletionPolicy,
  WorkflowTemplateVersion,
} from '@/types/workflowTemplate';
import { effectiveCompletionPolicy } from '@/domain/workflow/completionPolicy';
import { WorkflowCompletionEditor } from '@/components/settings/WorkflowCompletionEditor';
import { useOrganization } from '@/hooks/useOrganization';
import { useApproveWorkflowVersion } from '@/hooks/useApproveWorkflowVersion';
import { isWorkflowApprovalRequired, isWorkflowByServiceType } from '@/domain/workflow/selectWorkflowTemplate';
import { isApprovedVersion, latestApprovedVersion } from '@/domain/workflow/snapshot';
import { WorkflowTemplateServiceLine } from '@/components/settings/WorkflowTemplateServiceLine';
import { WorkflowStageEditor } from '@/components/settings/WorkflowStageEditor';
import { WorkflowServiceAssignment } from '@/components/settings/WorkflowServiceAssignment';
import { WorkflowPreview } from '@/components/settings/WorkflowPreview';
import { DraftApprovalReadiness, ProblemList, VersionApproveControl } from '@/components/settings/WorkflowApprovalProblems';
import styles from './WorkflowEditor.module.css';
import { WorkflowEditorClassic } from './WorkflowEditorClassic';

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
  // Phase 19A (Secure Payment Architecture): 'creditCard' | 'expiration' |
  // 'cvv' — three separate, ordinary-field card sub-types — are gone.
  // 'payment' represents an entire secure payment section instead; see
  // NewCaseModal.tsx's own PAYMENT_SUBFIELDS and
  // docs/adr/ADR-021-secure-payment-architecture.md.
  { value: 'payment', label: 'Payment (secure)' },
];

const VALIDATION_TYPE_OPTIONS = ['none', 'email', 'phone', 'date', 'zip', 'numeric', 'currency', 'time'] as const;

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


/** The service assignment a version stands for: its own proposal, else the
    template's current assignment. */
function versionServiceTypeCodes(version: WorkflowTemplateVersion, templateCodes: string[] | undefined): string[] {
  return [...(version.serviceTypeCodes ?? templateCodes ?? [])];
}

const sameCodes = (a: readonly string[], b: readonly string[]) => [...a].sort().join('|') === [...b].sort().join('|');

/** Unfinished-workflow protection (2026-10): what the approver affirms,
    in the page, before "Confirm approval" is enabled. */
const ATTESTATION_ITEMS: { key: keyof WorkflowApprovalAttestation; label: string }[] = [
  { key: 'stagesReviewed', label: 'I reviewed this service’s own stages — none is a copied or placeholder step.' },
  { key: 'checklistReviewed', label: 'I reviewed every checklist item.' },
  { key: 'completionReviewed', label: 'I reviewed the completion rules (Completion section).' },
];

const NO_ATTESTATION: WorkflowApprovalAttestation = { stagesReviewed: false, checklistReviewed: false, completionReviewed: false };

function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString() : '';
}

/**
 * Phase 18 (Workflow Management) / Phase 19 (Configurable Intake Form
 * Builder) / workflow template editor (2026-10). Views the selected
 * template's version history and edits its latest version's content
 * before saving, which always creates one brand-new
 * WorkflowTemplateVersion (useCreateWorkflowVersion -> POST .../versions),
 * never touching a historical one or any existing case (cases keep their
 * frozen workflowSnapshot).
 *
 * What can be edited:
 * - stages, by DISPLAY stage (what staff see as one step): add, remove,
 *   rename, reorder, SLA target, attention flag — a combined stage (the
 *   cremation First Call & Payment) moves and edits as one unit;
 * - checklist items: add, remove, rename, reorder, and the requirements
 *   the engine supports (data entry, 12-hour time picker, masked,
 *   completion from case fields);
 * - intake fields (Phase 19);
 * - for an organization with service-specific workflows, the service the
 *   template serves (applied when the version is approved);
 * - for an organization whose versions require approval (2026-10), the
 *   Completion section — how a case of this service is finished
 *   (WorkflowCompletionEditor), saved with the draft version, shown in the
 *   preview and validated on approval; and approval itself asks the
 *   approver to affirm, in the page, that the stages, checklist items and
 *   completion rules were reviewed (the route requires that attestation).
 * Every structural operation goes through domain/workflow/templateEditing.ts,
 * which renumbers rawStage/displayStage/index so the saved version is
 * always coherent; domain/workflow/templateValidation.ts reports problems
 * ('draft' level blocks saving, 'approval' level blocks approving) and the
 * server enforces both. "Preview" renders the draft as staff will see it.
 * The template's own name/enabled flag and caseTypes are not edited here.
 *
 * `draftStages`/`draftIntake` are local, fully-detached working copies
 * (structuredClone) of the latest version's content — nothing here mutates
 * the query cache until a save actually succeeds, matching the read-only
 * guarantee every other consumer of WorkflowTemplate/CaseWorkflowSnapshot
 * already relies on.
 */
export function WorkflowEditor({ templateId }: { templateId: string }) {
  const { organizationId } = useOrganization();
  // Structure editing, drafts and approval are for organizations whose
  // workflow versions go through approval (Gus); everyone else keeps the
  // editor they had.
  return isWorkflowApprovalRequired(organizationId) ? <GovernedWorkflowEditor templateId={templateId} /> : <WorkflowEditorClassic templateId={templateId} />;
}

function GovernedWorkflowEditor({ templateId }: { templateId: string }) {
  const { data: template, isPending } = useWorkflowTemplate(templateId);
  const createVersion = useCreateWorkflowVersion(templateId);
  // Service-specific workflows (2026-10): draft/approved status and the
  // "Approve version" action, only for an organization whose versions
  // require approval. Everyone else sees exactly the previous editor.
  const { organizationId } = useOrganization();
  const approvalRequired = isWorkflowApprovalRequired(organizationId);
  const byServiceType = isWorkflowByServiceType(organizationId);
  const approveVersion = useApproveWorkflowVersion(templateId);
  const [pendingApproval, setPendingApproval] = useState<number | null>(null);
  const [draftStages, setDraftStages] = useState<StageTemplate[] | null>(null);
  const [draftIntake, setDraftIntake] = useState<IntakeTemplate | null>(null);
  const [draftServiceCodes, setDraftServiceCodes] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [draftCompletionPolicy, setDraftCompletionPolicy] = useState<WorkflowCompletionPolicy | null>(null);
  const [attestation, setAttestation] = useState<WorkflowApprovalAttestation>(NO_ATTESTATION);

  const latestVersion = template?.versions[template.versions.length - 1];

  useEffect(() => {
    if (latestVersion && template) {
      setDraftStages(structuredClone(latestVersion.stages));
      setDraftIntake(structuredClone(latestVersion.intake));
      setDraftServiceCodes(versionServiceTypeCodes(latestVersion, template.serviceTypeCodes));
      // A version without a policy is judged by today's rule; the editor
      // starts from that rule made explicit.
      setDraftCompletionPolicy(approvalRequired ? effectiveCompletionPolicy(latestVersion) : null);
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
  const savedServiceCodes = versionServiceTypeCodes(version, template.serviceTypeCodes);

  const completionPolicy = approvalRequired ? draftCompletionPolicy : null;
  const isDirty =
    JSON.stringify(stages) !== JSON.stringify(version.stages) ||
    JSON.stringify(intake) !== JSON.stringify(version.intake) ||
    (byServiceType && !sameCodes(draftServiceCodes, savedServiceCodes)) ||
    (completionPolicy !== null && JSON.stringify(completionPolicy) !== JSON.stringify(effectiveCompletionPolicy(version)));
  // 'draft' level only — what must hold for a version to be stored at all.
  // Completeness ('approval' level) is shown separately and never blocks a
  // save: an administrator can save work in progress.
  const validationErrors = [
    ...problemMessages(validateWorkflowStages(stages, 'draft', completionPolicy ? { completionPolicy } : {})),
    ...validateIntakeFields(intake),
  ];

  const groups = groupStagesByDisplayStage(stages);
  const firstStagePinned = isFirstStageLinkedToIntake(stages, intake);
  const pinnedReason = 'Intake fields fill this stage’s checklist, so it stays first.';

  function editStages(fn: (prev: StageTemplate[]) => StageTemplate[]) {
    setDraftStages((prev) => fn(prev!));
  }

  function moveItem(groupIndex: number, itemIndex: number, direction: 'up' | 'down') {
    if (groupIndex === 0) {
      const order = itemOrderAfterMove(groups[0][0].checklist.items.length, itemIndex, direction);
      setDraftIntake((prev) => remapIntakeAfterFirstStageChange(prev!, order));
    }
    editStages((prev) => moveChecklistItem(prev, groupIndex, itemIndex, direction));
  }

  function removeItem(groupIndex: number, itemIndex: number) {
    if (groupIndex === 0) {
      const order = itemOrderAfterRemoval(groups[0][0].checklist.items.length, itemIndex);
      setDraftIntake((prev) => remapIntakeAfterFirstStageChange(prev!, order));
    }
    editStages((prev) => removeChecklistItem(prev, groupIndex, itemIndex));
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
    setDraftServiceCodes(savedServiceCodes);
    setDraftCompletionPolicy(approvalRequired ? effectiveCompletionPolicy(version) : null);
  }

  function handleSave() {
    if (validationErrors.length > 0) return;
    createVersion.mutate({
      stages,
      intake,
      ...(byServiceType ? { serviceTypeCodes: draftServiceCodes } : {}),
      ...(completionPolicy ? { completionPolicy } : {}),
    });
  }

  function startApproval(versionNumber: number) {
    setAttestation(NO_ATTESTATION);
    setPendingApproval(versionNumber);
  }
  const attested = ATTESTATION_ITEMS.every((item) => attestation[item.key]);

  const approveError = approveVersion.error as (Error & { details?: string[] }) | null;

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <h2 className={styles.templateName}>{template.name}</h2>
        <div className={styles.versionBadge}>Version {latestVersion.version}</div>
      </div>

      {byServiceType && <WorkflowTemplateServiceLine serviceTypeCodes={template.serviceTypeCodes ?? []} />}
      {template.description && <p className={styles.templateDescription}>{template.description}</p>}
      {approvalRequired && !latestApprovedVersion(template) && (
        <div className={styles.approvalBanner} role="status" data-testid="workflow-not-approved">
          Not approved — cases cannot use this workflow until an administrator approves a version.
        </div>
      )}

      <div className={styles.versionHistory}>
        <div className={styles.sectionLabel}>Version history</div>
        {[...template.versions].reverse().map((v) => (
          <div key={v.version} className={styles.versionEntry}>
            <div className={styles.versionRow}>
              <span>Version {v.version}</span>
              <span className={styles.versionDate}>{new Date(v.createdAt).toLocaleDateString()}</span>
              {(v.createdByName || v.createdBy) && (
                <span className={styles.versionDate} data-testid={`workflow-version-author-${v.version}`}>
                  Saved by {v.createdByName ?? v.createdBy}
                </span>
              )}
              {approvalRequired && (
                <span
                  className={isApprovedVersion(v) ? styles.approvedBadge : styles.draftBadge}
                  data-testid={`workflow-version-status-${v.version}`}
                >
                  {isApprovedVersion(v) ? 'Approved' : 'Draft — requires approval'}
                </span>
              )}
              {approvalRequired && isApprovedVersion(v) && (v.approvedByName || v.approvedBy) && (
                <span className={styles.versionDate} data-testid={`workflow-version-approver-${v.version}`}>
                  Approved by {v.approvedByName ?? v.approvedBy}
                  {v.approvedAt ? ` on ${formatDate(v.approvedAt)}` : ''}
                </span>
              )}
              {v.version === latestVersion.version && <span className={styles.currentBadge}>Current</span>}
            </div>
            {approvalRequired && !isApprovedVersion(v) && pendingApproval !== v.version && (
              <VersionApproveControl
                template={template}
                version={v}
                disabled={approveVersion.isPending}
                onApprove={() => startApproval(v.version)}
              />
            )}
          </div>
        ))}
        {approvalRequired && pendingApproval !== null && (
          <div className={styles.approvalConfirm} role="region" aria-label="Confirm approval" data-testid="workflow-approval-confirm">
            <p>
              Approve version {pendingApproval} of {template.name}? New cases for this service will use it immediately.
              Existing cases keep the workflow they already have.
            </p>
            <ul className={styles.attestationList} aria-label="Review before approving" data-testid="workflow-approval-attestation">
              {ATTESTATION_ITEMS.map((item) => (
                <li key={item.key} className={styles.completionToggle}>
                  <Checkbox
                    checked={attestation[item.key]}
                    onChange={() => setAttestation((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                    aria-label={item.label}
                  />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
            <div className={styles.approvalActions}>
              <button type="button" className="sx-btn sx-btn-ghost" onClick={() => setPendingApproval(null)} disabled={approveVersion.isPending}>
                Cancel
              </button>
              <button
                type="button"
                className="sx-btn sx-btn-primary"
                disabled={approveVersion.isPending || !attested}
                title={attested ? undefined : 'Confirm each review above first.'}
                onClick={() => approveVersion.mutate({ version: pendingApproval, attestation }, { onSuccess: () => setPendingApproval(null) })}
              >
                {approveVersion.isPending ? 'Approving…' : 'Confirm approval'}
              </button>
            </div>
            {approveVersion.isError && approveError && (
              <div className={styles.approvalError} role="alert">
                {approveError.message}
                {approveError.details && approveError.details.length > 0 && <ProblemList problems={approveError.details} />}
              </div>
            )}
          </div>
        )}
      </div>

      {byServiceType && (
        <WorkflowServiceAssignment template={template} selected={draftServiceCodes} onChange={setDraftServiceCodes} />
      )}

      <div className={styles.previewToggleRow}>
        <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={() => setShowPreview((shown) => !shown)} aria-expanded={showPreview}>
          {showPreview ? 'Hide preview' : 'Preview workflow'}
        </button>
      </div>
      {showPreview && <WorkflowPreview organizationId={organizationId} stages={stages} completionPolicy={completionPolicy} />}

      <div className={styles.stages}>
        {groups.map((group, index) => {
          const pinsThis = firstStagePinned && index === 0;
          const pinnedBelow = firstStagePinned && index === 1;
          return (
            <WorkflowStageEditor
              key={index}
              group={group}
              position={index}
              stageCount={groups.length}
              canMoveUp={index > 0 && !pinnedBelow}
              canMoveDown={index < groups.length - 1 && !pinsThis}
              canRemove={groups.length > 1 && !pinsThis}
              lockedReason={pinsThis ? pinnedReason : null}
              itemLockReason={(itemIndex) => {
                if (index !== 0) return null;
                const linked = intakeFieldsLinkedToFirstStageItem(stages, intake, itemIndex);
                return linked.length > 0 ? `Filled from the intake field(s) ${linked.join(', ')} — remove or relink those first.` : null;
              }}
              handlers={{
                onUpdateStage: (patch) => editStages((prev) => updateStage(prev, index, patch)),
                onMoveStage: (direction) => editStages((prev) => moveDisplayStage(prev, index, direction)),
                onRemoveStage: () => editStages((prev) => removeStage(prev, index)),
                onAddItem: () => editStages((prev) => addChecklistItem(prev, index)),
                onUpdateItem: (itemIndex: number, patch: ChecklistItemPatch) => editStages((prev) => updateChecklistItem(prev, index, itemIndex, patch)),
                onMoveItem: (itemIndex, direction) => moveItem(index, itemIndex, direction),
                onRemoveItem: (itemIndex) => removeItem(index, itemIndex),
              }}
            />
          );
        })}
        <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={() => editStages((prev) => addStage(prev))}>
          + Add stage
        </button>
      </div>

      {completionPolicy && <WorkflowCompletionEditor stages={stages} policy={completionPolicy} onChange={setDraftCompletionPolicy} />}

      <div className={styles.intakeEditor}>
        <div className={styles.sectionLabel}>Intake form fields</div>
        {draftIntake.sections.map((section, sectionIndex) => (
          <div key={section.key} className={styles.intakeSection}>
            <div className={styles.intakeSectionLabel}>{section.label}</div>
            {section.fields.map((field, fieldIndex) => (
              <div key={field.key} className={styles.intakeFieldRow}>
                <div className={styles.intakeFieldRowTop}>
                  <TextField
                    className={`${styles.intakeFieldLabelInput} sx-input`}
                    value={field.label}
                    onChange={(e) => updateIntakeField(sectionIndex, fieldIndex, { label: e.target.value })}
                    aria-label={`Intake field ${fieldIndex + 1} label in "${section.label}"`}
                  />
                  <SelectField
                    className="sx-select"
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

                {field.fieldType === 'payment' ? (
                  // Phase 19A (Secure Payment Architecture): a payment
                  // field's only configurable properties are purpose/
                  // amount/description (plus label/required above) —
                  // never placeholder/validationType/uppercase/masked/
                  // options, none of which mean anything for an entire
                  // secure section rather than an ordinary data field.
                  <div className={styles.intakeFieldRowBottom}>
                    <TextField
                      className="sx-input"
                      value={field.paymentPurpose ?? ''}
                      onChange={(e) =>
                        updateIntakeField(sectionIndex, fieldIndex, { paymentPurpose: e.target.value })
                      }
                      placeholder="Payment purpose (e.g. Cremation service fee)"
                      aria-label={`"${field.label}" payment purpose`}
                    />
                    <TextField
                      className="sx-input"
                      value={field.paymentAmount ?? ''}
                      onChange={(e) =>
                        updateIntakeField(sectionIndex, fieldIndex, { paymentAmount: e.target.value })
                      }
                      placeholder="Amount (optional)"
                      aria-label={`"${field.label}" payment amount`}
                    />
                    <TextField
                      className="sx-input"
                      value={field.paymentDescription ?? ''}
                      onChange={(e) =>
                        updateIntakeField(sectionIndex, fieldIndex, { paymentDescription: e.target.value })
                      }
                      placeholder="Description (optional)"
                      aria-label={`"${field.label}" payment description`}
                    />
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
                  </div>
                ) : (
                  <div className={styles.intakeFieldRowBottom}>
                    <TextField
                      className="sx-input"
                      value={field.placeholder ?? ''}
                      onChange={(e) => updateIntakeField(sectionIndex, fieldIndex, { placeholder: e.target.value })}
                      placeholder="Placeholder text"
                      aria-label={`"${field.label}" placeholder`}
                    />
                    <SelectField
                      className="sx-select"
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
                )}

                {field.fieldType === 'select' && (
                  <TextField
                    className={`${styles.intakeFieldOptionsInput} sx-input`}
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
            <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={() => addIntakeField(sectionIndex)}>
              + Add intake field
            </button>
          </div>
        ))}
      </div>

      {isDirty && validationErrors.length > 0 && (
        <div className={`${styles.saveError} sx-error`} role="alert" data-testid="workflow-save-problems">
          {validationErrors.length === 1 ? validationErrors[0] : <ProblemList problems={validationErrors} />}
        </div>
      )}
      {createVersion.isError && (
        <div className={`${styles.saveError} sx-error`} role="alert">
          {(createVersion.error as Error).message}
        </div>
      )}
      {approvalRequired && validationErrors.length === 0 && (
        <DraftApprovalReadiness
          template={template}
          stages={stages}
          serviceTypeCodes={byServiceType ? draftServiceCodes : undefined}
          completionPolicy={completionPolicy}
          derivedFrom={version.derivedFrom ?? null}
          composition={version.composition ?? null}
        />
      )}

      <div className="sx-save-row">
        <button type="button" className="sx-btn sx-btn-ghost" onClick={handleDiscard} disabled={!isDirty || createVersion.isPending}>
          Discard changes
        </button>
        <button
          type="button"
          className="sx-btn sx-btn-primary"
          onClick={handleSave}
          disabled={!isDirty || validationErrors.length > 0 || createVersion.isPending}
        >
          {createVersion.isPending ? 'Saving…' : approvalRequired ? 'Save as draft version' : 'Save as new version'}
        </button>
      </div>
    </div>
  );
}
