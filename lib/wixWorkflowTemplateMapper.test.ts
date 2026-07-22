import { describe, expect, it } from 'vitest';
import {
  buildWorkflowTemplate,
  mapWixWorkflowTemplateItem,
  mapWixWorkflowTemplateVersionItem,
} from './wixWorkflowTemplateMapper';

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
