import { describe, expect, it } from 'vitest';
import {
  buildWorkflowTemplate,
  buildWixWorkflowTemplateVersionData,
  mapWixWorkflowTemplateItem,
  mapWixWorkflowTemplateVersionItem,
  validateWorkflowStagesPayload,
} from './wixWorkflowTemplateMapper';
import type { StageTemplate } from '../types/workflowTemplate';

const validTemplateItem = {
  beaconTemplateId: 'workflow-template-standard-cremation',
  organizationId: 'managed-cremations',
  isSystemTemplate: false,
  name: 'Standard Cremation Workflow',
  isEnabled: true,
  caseTypes: ['cremation'],
  _id: 'some-random-wix-guid',
};

const validVersionItem = {
  beaconTemplateId: 'workflow-template-standard-cremation',
  version: 1,
  caseTypes: ['cremation'],
  stages: [{ rawStage: 0, displayStage: 0, label: 'First Call & Payment', slaTargetDays: 1, checklist: { items: [] } }],
  intake: { sections: [] },
  createdAt: '2026-07-22T00:49:03.000Z',
  _id: 'another-random-wix-guid',
};

describe('mapWixWorkflowTemplateItem', () => {
  it('maps a well-formed item to the template summary shape', () => {
    const result = mapWixWorkflowTemplateItem(validTemplateItem);
    expect(result).toEqual({
      id: 'workflow-template-standard-cremation',
      organizationId: 'managed-cremations',
      name: 'Standard Cremation Workflow',
      isEnabled: true,
      caseTypes: ['cremation'],
    });
  });

  it('never uses the Wix system _id as the template id or name', () => {
    const result = mapWixWorkflowTemplateItem(validTemplateItem);
    expect(result?.id).toBe('workflow-template-standard-cremation');
    expect(result?.id).not.toBe('some-random-wix-guid');
  });

  it('returns null when required fields are missing or the wrong type', () => {
    expect(mapWixWorkflowTemplateItem(undefined)).toBeNull();
    expect(mapWixWorkflowTemplateItem({ ...validTemplateItem, beaconTemplateId: undefined })).toBeNull();
    expect(mapWixWorkflowTemplateItem({ ...validTemplateItem, isEnabled: 'yes' })).toBeNull();
    expect(mapWixWorkflowTemplateItem({ ...validTemplateItem, caseTypes: 'cremation' })).toBeNull();
    expect(mapWixWorkflowTemplateItem({ ...validTemplateItem, caseTypes: [1, 2] })).toBeNull();
  });
});

describe('mapWixWorkflowTemplateVersionItem', () => {
  it('maps a well-formed item to the WorkflowTemplateVersion shape', () => {
    const result = mapWixWorkflowTemplateVersionItem(validVersionItem);
    expect(result).toEqual({
      version: 1,
      caseTypes: ['cremation'],
      stages: validVersionItem.stages,
      intake: validVersionItem.intake,
      createdAt: '2026-07-22T00:49:03.000Z',
    });
  });

  it('passes stages/intake content through unchanged (no normalization of snapshot meaning)', () => {
    const result = mapWixWorkflowTemplateVersionItem(validVersionItem);
    expect(result?.stages).toBe(validVersionItem.stages);
    expect(result?.intake).toBe(validVersionItem.intake);
  });

  it('returns null when required fields are missing or the wrong type', () => {
    expect(mapWixWorkflowTemplateVersionItem(undefined)).toBeNull();
    expect(mapWixWorkflowTemplateVersionItem({ ...validVersionItem, version: '1' })).toBeNull();
    expect(mapWixWorkflowTemplateVersionItem({ ...validVersionItem, stages: 'not-an-array' })).toBeNull();
    expect(mapWixWorkflowTemplateVersionItem({ ...validVersionItem, intake: null })).toBeNull();
    expect(mapWixWorkflowTemplateVersionItem({ ...validVersionItem, createdAt: 12345 })).toBeNull();
  });
});

describe('buildWorkflowTemplate', () => {
  const summary = {
    id: 'workflow-template-standard-cremation',
    organizationId: 'managed-cremations',
    name: 'Standard Cremation Workflow',
    isEnabled: true,
    caseTypes: ['cremation'],
  };

  it('assembles a template with its versions sorted ascending, so versions[length-1] is latest', () => {
    const v2 = { ...mapWixWorkflowTemplateVersionItem(validVersionItem)!, version: 2 };
    const v1 = mapWixWorkflowTemplateVersionItem(validVersionItem)!;
    // Deliberately passed out of order.
    const result = buildWorkflowTemplate(summary, [v2, v1]);

    expect(result?.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(result?.versions[result.versions.length - 1].version).toBe(2);
  });

  it('returns null when there are zero valid versions — excluded, not returned broken', () => {
    expect(buildWorkflowTemplate(summary, [])).toBeNull();
  });
});

const validStage: StageTemplate = {
  rawStage: 0,
  displayStage: 0,
  label: 'First Call & Payment',
  isAttentionStage: false,
  slaTargetDays: 1,
  checklist: {
    items: [{ index: 0, label: 'Name of deceased', hasField: true, isPasswordField: false, externalFormIntegrationId: null }],
  },
};

describe('validateWorkflowStagesPayload — Phase 18 (Workflow Management)', () => {
  it('accepts a well-formed stages array', () => {
    const result = validateWorkflowStagesPayload({ stages: [validStage] });
    expect(result.errors).toEqual([]);
    expect(result.stages).toEqual([validStage]);
  });

  it('rejects a body with no stages array at all', () => {
    const result = validateWorkflowStagesPayload({ notStages: [] });
    expect(result.stages).toBeNull();
    expect(result.errors).toContain('body.stages must be an array.');
  });

  it('rejects a stage missing required fields', () => {
    const result = validateWorkflowStagesPayload({ stages: [{ label: 'Only a label' }] });
    expect(result.stages).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a stage whose label is the wrong type', () => {
    const bad = { ...validStage, label: 123 };
    const result = validateWorkflowStagesPayload({ stages: [bad] });
    expect(result.stages).toBeNull();
    expect(result.errors.some((e) => e.includes('label must be a string'))).toBe(true);
  });

  it('allows slaTargetDays to be null', () => {
    const withNull = { ...validStage, slaTargetDays: null };
    const result = validateWorkflowStagesPayload({ stages: [withNull] });
    expect(result.errors).toEqual([]);
  });

  it('rejects a malformed checklist item nested inside an otherwise-valid stage', () => {
    const badItem = { ...validStage, checklist: { items: [{ index: 'zero', label: 'X', hasField: false }] } };
    const result = validateWorkflowStagesPayload({ stages: [badItem] });
    expect(result.stages).toBeNull();
    expect(result.errors.some((e) => e.includes('index must be a number'))).toBe(true);
  });

  it('rejects when checklist.items is missing entirely', () => {
    const noChecklist = { ...validStage, checklist: {} };
    const result = validateWorkflowStagesPayload({ stages: [noChecklist] });
    expect(result.stages).toBeNull();
  });

  it('does not silently drop unknown extra fields — accepts them without corrupting known ones', () => {
    const withExtra = { ...validStage, someFutureField: 'ignored' };
    const result = validateWorkflowStagesPayload({ stages: [withExtra] });
    expect(result.errors).toEqual([]);
    expect(result.stages?.[0]).not.toHaveProperty('someFutureField');
  });
});

describe('buildWixWorkflowTemplateVersionData — Phase 18', () => {
  it('builds a complete Wix item data object for insertion', () => {
    const result = buildWixWorkflowTemplateVersionData({
      beaconTemplateId: 'workflow-template-standard-cremation',
      version: 2,
      caseTypes: ['cremation'],
      stages: [validStage],
      intake: { sections: [] },
      createdAt: '2026-07-23T00:00:00.000Z',
    });

    expect(result).toEqual({
      beaconTemplateId: 'workflow-template-standard-cremation',
      version: 2,
      caseTypes: ['cremation'],
      stages: [validStage],
      intake: { sections: [] },
      createdAt: '2026-07-23T00:00:00.000Z',
    });
  });
});
