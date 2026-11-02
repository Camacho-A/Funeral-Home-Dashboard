import { describe, expect, it } from 'vitest';
import { remapCaseWorkflow } from './remapCaseWorkflow';
import { applyWorkflowChangeToCase, planCaseWorkflowChange } from './planCaseWorkflowChange';
import { buildCaseWorkflowSnapshot } from './snapshot';
import { resolveChecklist } from './resolveChecklist';
import { displayStagesInOrder } from './resolveStages';
import { buildGusServiceWorkflowTemplateFixtures, GUS_WORKFLOW_TEMPLATE_ID } from '../../services/__mocks__/workflowTemplates';
import { caseFixtures } from '../../services/__mocks__/fixtures';
import { GUS_SERVICE_CATALOG } from '../onboarding/gusServiceCatalog';
import type { Case } from '../../types/case';
import type { CaseWorkflowSnapshot, StageTemplate, WorkflowTemplate } from '../../types/workflowTemplate';

const GUS = 'gus-camacho-jr';
const options = {
  activeServiceTypeCodes: GUS_SERVICE_CATALOG.map((entry) => entry.serviceCode),
  serviceDisplayName: (code: string) => GUS_SERVICE_CATALOG.find((entry) => entry.serviceCode === code)?.displayName,
};

/** A fictional Gus case on Direct Cremation, sitting at raw stage 4
    (Permit & Authorization) with the permit sent. */
function gusCaseAtPermit(): Case {
  const base = caseFixtures.find((c) => c.organizationId === GUS && c.rawStage === 4)!;
  const direct = buildGusServiceWorkflowTemplateFixtures().find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;
  const version = direct.versions[direct.versions.length - 1];
  return {
    ...structuredClone(base),
    workflowTemplateId: direct.id,
    workflowTemplateVersion: version.version,
    workflowSnapshot: buildCaseWorkflowSnapshot(direct, version, 'DIRECT_CREMATION'),
    certifierName: 'DR. SAMPLE CERTIFIER',
    certifierPhone: '(555) 010-0199',
    // Gus's Certifier Information needs the fax too (2026-11).
    certifierFax: '(555) 010-0198',
    checklistState: { '3:0': true },
    fieldValues: { 3: '150 lb' },
  };
}

/**
 * An administrator-approved Cremation with Viewing version, differing from
 * Direct Cremation in three fictional ways (test data only — not a claim
 * about the real service): EDRS gains a new item at index 1 (shifting
 * "Cause of death entered" to index 2) and drops "Hardsave…"; the pickup
 * stage drops "Labels made".
 */
function approvedViewingTemplates(): WorkflowTemplate[] {
  const templates = structuredClone(buildGusServiceWorkflowTemplateFixtures());
  const viewing = templates.find((t) => t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;
  const stages: StageTemplate[] = structuredClone(viewing.versions[0].stages);
  const edrs = stages.find((s) => s.rawStage === 3)!;
  edrs.checklist.items = [
    { index: 0, label: 'EDRS submitted & sent to doctor', hasField: false },
    { index: 1, label: 'Viewing scheduled with family', hasField: false },
    { index: 2, label: 'Cause of death entered', hasField: false },
  ];
  const pickup = stages.find((s) => s.rawStage === 6)!;
  pickup.checklist.items = pickup.checklist.items
    .filter((item) => item.label !== 'Labels made')
    .map((item, index) => ({ ...item, index }));
  viewing.versions = [{ ...viewing.versions[0], version: 2, status: 'approved', stages }];
  return templates;
}

function snapshotFor(template: WorkflowTemplate, serviceTypeCode: string): CaseWorkflowSnapshot {
  return buildCaseWorkflowSnapshot(template, template.versions[template.versions.length - 1], serviceTypeCode);
}

describe('remapCaseWorkflow', () => {
  const templates = approvedViewingTemplates();
  const direct = templates.find((t) => t.id === GUS_WORKFLOW_TEMPLATE_ID)!;
  const viewing = templates.find((t) => t.serviceTypeCodes?.includes('CREMATION_WITH_VIEWING'))!;

  it('onto an identical structure keeps every completed step and the same stage', () => {
    const case_ = gusCaseAtPermit();
    const sameShape = { ...snapshotFor(direct, 'DIRECT_CREMATION'), workflowTemplateId: 'another-template' };
    const remap = remapCaseWorkflow(case_, case_.workflowSnapshot!, sameShape);
    expect(remap.notCarried).toEqual([]);
    expect(remap.newRequirements).toEqual([]);
    expect(remap.newRawStage).toBe(4);
    expect(remap.movesBackward).toBe(false);
    expect(remap.kept.length).toBe(11 + 1 + 3 + 1);
  });

  it('keeps matching steps, reports steps not carried over and new requirements, and never completes a new requirement', () => {
    const case_ = gusCaseAtPermit();
    const target = snapshotFor(viewing, 'CREMATION_WITH_VIEWING');
    const remap = remapCaseWorkflow(case_, case_.workflowSnapshot!, target);

    expect(remap.notCarried.map((i) => [i.label, i.reason])).toEqual([['Hardsave for state approval if not an online doctor', 'no_matching_item']]);
    expect(remap.newRequirements.map((i) => i.label)).toEqual(['Viewing scheduled with family']);
    expect(remap.kept.map((k) => k.to.label)).toContain('Cause of death entered');
    // "Cause of death entered" moved from index 1 to 2 — written under the
    // NEW key, never under the old one.
    expect(remap.newChecklistState['2:2']).toBe(true);
    expect(remap.newChecklistState['2:1']).toBeUndefined();
    // The new requirement is never marked done…
    const viewingCase = { ...case_, workflowSnapshot: target, checklistState: remap.newChecklistState, fieldValues: remap.newFieldValues };
    const edrs = displayStagesInOrder(target).find((s) => s.displayStage === 2)!;
    const resolved = resolveChecklist(edrs.checklist.items, 2, viewingCase);
    expect(resolved.find((i) => i.label === 'Viewing scheduled with family')!.done).toBe(false);
    // …so the case lands back on EDRS, and the preview says it moves back.
    expect(remap.newRawStage).toBe(3);
    expect(remap.newStageLabel).toBe('EDRS & Doctor / Cause of Death');
    expect(remap.previousStageLabel).toBe('Permit & Authorization Sent to Crematory');
    expect(remap.movesBackward).toBe(true);
  });

  it('only ever writes keys of the new snapshot, and carries field values to their new index', () => {
    const case_ = gusCaseAtPermit();
    const target = snapshotFor(viewing, 'CREMATION_WITH_VIEWING');
    const remap = remapCaseWorkflow(case_, case_.workflowSnapshot!, target);
    const validKeys = new Set(target.stages.flatMap((s) => s.checklist.items.map((i) => `${s.displayStage}:${i.index}`)));
    for (const key of Object.keys(remap.newChecklistState)) expect(validKeys.has(key)).toBe(true);
    expect(remap.newFieldValues).toEqual({ 3: '150 lb' });
  });

  it('a past-stage step whose value is not on record is reported, not silently claimed', () => {
    const case_ = { ...gusCaseAtPermit(), certifierName: null, certifierPhone: null, certifierFax: null };
    const remap = remapCaseWorkflow(case_, case_.workflowSnapshot!, snapshotFor(viewing, 'CREMATION_WITH_VIEWING'));
    expect(remap.notCarried).toContainEqual(expect.objectContaining({ label: 'Certifier Information', reason: 'value_required' }));
    expect(remap.newRawStage).toBe(0);
    expect(remap.movesBackward).toBe(true);
  });
});

describe('planCaseWorkflowChange + applyWorkflowChangeToCase', () => {
  const templates = approvedViewingTemplates();

  it('a dry-run plan describes the change and the exact write; applying appends the prior state to history', () => {
    const case_ = gusCaseAtPermit();
    const plan = planCaseWorkflowChange(case_, templates, { serviceTypeCode: 'CREMATION_WITH_VIEWING', expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID }, options);
    expect(plan.ok).toBe(true);
    if (!plan.ok || !plan.write) throw new Error('expected a write');
    expect(plan.preview).toMatchObject({
      unchanged: false,
      from: { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, workflowName: 'Direct Cremation', serviceTypeCode: 'DIRECT_CREMATION' },
      to: { workflowName: 'Cremation with Viewing', serviceTypeCode: 'CREMATION_WITH_VIEWING', workflowTemplateVersion: 2 },
    });

    const updated = applyWorkflowChangeToCase(case_, plan.write, { changedAt: '2026-10-15T12:00:00.000Z', changedByUserId: 'identity-gus-admin' });
    expect(updated.workflowSnapshot?.serviceTypeCode).toBe('CREMATION_WITH_VIEWING');
    expect(updated.rawStage).toBe(3);
    expect(updated.workflowHistory).toEqual([
      {
        workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID,
        workflowTemplateVersion: case_.workflowTemplateVersion,
        serviceTypeCode: 'DIRECT_CREMATION',
        rawStage: 4,
        checklistState: { '3:0': true },
        fieldValues: { 3: '150 lb' },
        changedAt: '2026-10-15T12:00:00.000Z',
        changedByUserId: 'identity-gus-admin',
      },
    ]);
    // A second change appends — history is never replaced.
    const again = applyWorkflowChangeToCase(updated, { ...plan.write, workflowTemplateId: 'x' }, { changedAt: 'later', changedByUserId: 'u' });
    expect(again.workflowHistory).toHaveLength(2);
  });

  it('refuses a draft target (422) and a stale expected workflow (409)', () => {
    const case_ = gusCaseAtPermit();
    expect(
      planCaseWorkflowChange(case_, templates, { serviceTypeCode: 'DIRECT_ENTOMBMENT', expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID }, options),
    ).toMatchObject({ ok: false, status: 422, reason: 'not_approved' });
    expect(
      planCaseWorkflowChange(case_, templates, { serviceTypeCode: 'CREMATION_WITH_VIEWING', expectedWorkflowTemplateId: 'something-else' }, options),
    ).toMatchObject({ ok: false, status: 409, reason: 'stale_workflow' });
  });

  it('the same workflow is "unchanged" — nothing to write, never an implicit upgrade', () => {
    const plan = planCaseWorkflowChange(gusCaseAtPermit(), templates, { serviceTypeCode: 'DIRECT_CREMATION', expectedWorkflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID }, options);
    expect(plan).toMatchObject({ ok: true, preview: { unchanged: true }, write: null });
  });
});
