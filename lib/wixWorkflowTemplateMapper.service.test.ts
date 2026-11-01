import { describe, expect, it } from 'vitest';
import { buildWixWorkflowTemplateVersionData, mapWixWorkflowTemplateVersionItem } from './wixWorkflowTemplateMapper';
import { workflowTemplateFixtures, standardCremationWorkflowTemplateFixture } from '@/services/__mocks__/workflowTemplates';

/** Service-based workflows (2026-11): the service and composition survive a Wix round-trip; Manors rows are unchanged. */
describe('workflow template version — service fields round-trip', () => {
  const gus = workflowTemplateFixtures.find((t) => t.name === 'Cremation with Viewing')!;
  const version = gus.versions.at(-1)!;

  it('a Gus service version keeps its service, composition and step ids', () => {
    const row = buildWixWorkflowTemplateVersionData({ beaconTemplateId: gus.id, ...version });
    expect(mapWixWorkflowTemplateVersionItem(row)).toEqual(version);
  });

  it('a Manors version writes and reads exactly the fields it always had', () => {
    const manors = standardCremationWorkflowTemplateFixture.versions.at(-1)!;
    const row = buildWixWorkflowTemplateVersionData({ beaconTemplateId: standardCremationWorkflowTemplateFixture.id, ...manors });
    expect(Object.keys(row).sort()).toEqual(['beaconTemplateId', 'caseTypes', 'createdAt', 'intake', 'stages', 'version']);
    expect(mapWixWorkflowTemplateVersionItem(row)).toEqual(manors);
  });

  it('malformed service fields are ignored rather than trusted', () => {
    const row = { ...buildWixWorkflowTemplateVersionData({ beaconTemplateId: gus.id, ...version }), serviceTypeCodes: 'DIRECT_CREMATION', composition: { base: 'x' } };
    const mapped = mapWixWorkflowTemplateVersionItem(row)!;
    expect(mapped.serviceTypeCodes).toBeUndefined();
    expect(mapped.composition).toBeUndefined();
  });
});
