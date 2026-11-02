import { describe, expect, it } from 'vitest';
import {
  caseIsInOrganizationStage,
  findOrganizationStage,
  isCaseOnTerminalStage,
  organizationStageLabels,
  resolveOrganizationStages,
  snapshotStageLabel,
  wixFilterForOrganizationStage,
} from './organizationStages';
import { STAGES, isBottleneckStage, rawStagesForDisplayStage } from '../cases/stages';
import { canonicalDisplayStagesForPresentedLabel, presentedStages, presentedStageLabels } from '../organization/workflowStagePresentation';
import {
  buildGusServiceWorkflowTemplateFixtures,
  standardCremationWorkflowTemplateFixture,
  secondOrgWorkflowTemplateFixture,
  GUS_WORKFLOW_TEMPLATE_ID,
  GUS_VIEWING_WORKFLOW_TEMPLATE_ID,
  GUS_FINAL_GOODBYE_WORKFLOW_TEMPLATE_ID,
} from '../../services/__mocks__/workflowTemplates';
import type { WorkflowTemplate } from '../../types/workflowTemplate';

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';
const EVERGREEN = 'evergreen-memorial-group';

describe('organizations without service workflows — identical to the STAGES surfaces', () => {
  it.each([MANORS, EVERGREEN])('%s: global labels, raw stages and attention flags match today exactly', (org) => {
    const templates = org === MANORS ? [standardCremationWorkflowTemplateFixture] : [secondOrgWorkflowTemplateFixture];
    const model = resolveOrganizationStages(org, templates);
    expect(model.kind).toBe('global');
    expect(organizationStageLabels(model)).toEqual(presentedStageLabels(org, STAGES));
    for (const stage of model.stages) {
      const canonical = canonicalDisplayStagesForPresentedLabel(org, stage.label, STAGES)!;
      expect(stage.globalRawStages).toEqual(canonical.flatMap((ds) => rawStagesForDisplayStage(ds)));
      expect(stage.isAttentionStage).toBe(canonical.some((ds) => isBottleneckStage(ds)));
      expect(stage.members).toEqual([]);
    }
    expect(model.stages.map((s) => s.label)).toEqual(presentedStages(org, STAGES).map((s) => s.label));
  });

  it('Manors still presents its combined intake stage (presentation overlay untouched)', () => {
    expect(organizationStageLabels(resolveOrganizationStages(MANORS, []))[0]).toBe('Intake & JotForm');
  });
});

describe('Gus — per-template organization stages', () => {
  const templates = buildGusServiceWorkflowTemplateFixtures();
  // Gus's three cremation services share the cremation process (2026-11).
  const CREMATION_TEMPLATE_IDS = [GUS_WORKFLOW_TEMPLATE_ID, GUS_VIEWING_WORKFLOW_TEMPLATE_ID, GUS_FINAL_GOODBYE_WORKFLOW_TEMPLATE_ID];

  it('lists the approved cremation stages only (drafts are never used by a case), First Call and JotForm separate', () => {
    const model = resolveOrganizationStages(GUS, templates);
    expect(model.kind).toBe('per_template');
    expect(organizationStageLabels(model)).toEqual([
      'First Call & Payment',
      'JotForm Application',
      'EDRS & Doctor / Cause of Death',
      'Permit & Authorization Sent to Crematory',
      'Death Certificate Application Sent',
      'Ready for Pickup / Contact Family',
      'Completed',
    ]);
    expect(organizationStageLabels(model)).not.toContain('Intake & JotForm');
    const firstCall = findOrganizationStage(model, 'First Call & Payment')!;
    expect(firstCall.members).toEqual(CREMATION_TEMPLATE_IDS.map((workflowTemplateId) => ({ workflowTemplateId, rawStages: [0, 1] })));
    expect(findOrganizationStage(model, 'EDRS & Doctor / Cause of Death')!.isAttentionStage).toBe(true);
    expect(findOrganizationStage(model, 'Completed')!.isTerminal).toBe(true);
  });

  it('unions approved workflows by label, keeps "Completed" last, and maps each label to (template, raw stages)', () => {
    const withBurial: WorkflowTemplate[] = structuredClone(templates);
    const graveside = withBurial.find((t) => t.serviceTypeCodes?.includes('GRAVESIDE_BURIAL_SERVICE_ONLY'))!;
    // An administrator-defined, approved version: shorter, one new stage.
    graveside.versions.push({
      ...structuredClone(graveside.versions[0]),
      version: 2,
      status: 'approved',
      stages: [
        { ...graveside.versions[0].stages[0], rawStage: 0, displayStage: 0 },
        { rawStage: 1, displayStage: 1, label: 'Cemetery Arrangements', isAttentionStage: true, slaTargetDays: 2, checklist: { items: [{ index: 0, label: 'Cemetery confirmed', hasField: false }] } },
        { rawStage: 2, displayStage: 2, label: 'Completed', isAttentionStage: false, slaTargetDays: null, checklist: { items: [{ index: 0, label: 'Service held', hasField: false }] } },
      ],
    });

    const model = resolveOrganizationStages(GUS, withBurial);
    const labels = organizationStageLabels(model);
    expect(labels[0]).toBe('First Call & Payment');
    expect(labels[labels.length - 1]).toBe('Completed');
    expect(labels).toContain('Cemetery Arrangements');
    expect(new Set(labels).size).toBe(labels.length);

    const completed = findOrganizationStage(model, 'Completed')!;
    expect(completed.members).toEqual([
      ...CREMATION_TEMPLATE_IDS.map((workflowTemplateId) => ({ workflowTemplateId, rawStages: [7] })),
      { workflowTemplateId: graveside.id, rawStages: [2] },
    ]);
    // Raw stage 2 means different things on the two templates.
    expect(caseIsInOrganizationStage(completed, { workflowTemplateId: graveside.id, rawStage: 2 })).toBe(true);
    expect(caseIsInOrganizationStage(completed, { workflowTemplateId: GUS_WORKFLOW_TEMPLATE_ID, rawStage: 2 })).toBe(false);
    expect(wixFilterForOrganizationStage(completed)).toEqual({
      $or: [
        ...CREMATION_TEMPLATE_IDS.map((workflowTemplateId) => ({ workflowTemplateId, currentStage: { $in: [7] } })),
        { workflowTemplateId: graveside.id, currentStage: { $in: [2] } },
      ],
    });
  });

  it('reads a case’s own stage name and terminal state from its snapshot', () => {
    const version = templates[0].versions[0];
    const snapshot = { workflowTemplateId: templates[0].id, workflowTemplateVersion: 1, stages: version.stages, intake: version.intake };
    expect(snapshotStageLabel(snapshot, 5)).toBe('Death Certificate Application Sent');
    expect(snapshotStageLabel(null, 5)).toBeNull();
    expect(isCaseOnTerminalStage({ workflowSnapshot: snapshot, rawStage: 7 })).toBe(true);
    expect(isCaseOnTerminalStage({ workflowSnapshot: snapshot, rawStage: 6 })).toBe(false);
  });
});
