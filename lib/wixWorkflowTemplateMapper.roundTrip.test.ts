import { describe, expect, it } from 'vitest';
import {
  buildApprovedWixWorkflowTemplateVersionData,
  buildWixWorkflowTemplateVersionApprovalFields,
  buildWixWorkflowTemplateData,
  buildWixWorkflowTemplateVersionData,
  mapWixWorkflowTemplateItem,
  mapWixWorkflowTemplateVersionItem,
  validateWorkflowStagesPayload,
} from './wixWorkflowTemplateMapper';
import { addChecklistItem, addStage, updateChecklistItem } from '@/domain/workflow/templateEditing';
import { buildGusWorkflowTemplateFixture, standardCremationWorkflowTemplateFixture } from '@/services/__mocks__/workflowTemplates';
import type { StageTemplate } from '@/types/workflowTemplate';

/**
 * Time of Death fix (2026-10). `validateWorkflowStagesPayload` dropped
 * ChecklistItemTemplate.valueKind, so every saved version lost the "Time of
 * death" item's 12-hour AM/PM picker. These round trips follow the real
 * path — editor state → JSON request body → the versions route's DTO
 * validation → the Wix row it inserts → JSON storage → the read mapper →
 * a second save of what was read (how live v6 was produced from v5) — and
 * prove every ChecklistItemTemplate / StageTemplate field survives.
 */

const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function saveAndReload(stages: StageTemplate[]): StageTemplate[] {
  const validated = validateWorkflowStagesPayload(json({ stages }));
  expect(validated.errors).toEqual([]);
  const row = json(
    buildWixWorkflowTemplateVersionData({
      beaconTemplateId: 't',
      version: 2,
      caseTypes: ['cremation'],
      stages: validated.stages!,
      intake: { sections: [] },
      createdAt: '2026-10-15T00:00:00.000Z',
      status: 'draft',
      createdBy: 'identity-x',
      createdByName: 'Example Admin',
      serviceTypeCodes: ['DIRECT_CREMATION'],
    }),
  );
  return mapWixWorkflowTemplateVersionItem(row)!.stages;
}

const timeOfDeath = (stages: StageTemplate[]) => stages.slice(0, 2).map((s) => s.checklist.items.find((i) => i.label === 'Time of death'));

describe('valueKind round trip (Time of death)', () => {
  it('editor save → mapper → Wix row → read → re-save keeps valueKind: "time" on both First Call raw stages', () => {
    const edited = addStage(structuredClone(buildGusWorkflowTemplateFixture().versions[0].stages));
    const once = saveAndReload(edited);
    const twice = saveAndReload(once);
    for (const stages of [once, twice]) {
      expect(timeOfDeath(stages).map((item) => item?.valueKind)).toEqual(['time', 'time']);
    }
    expect(twice).toEqual(edited);
  });

  it('Manors v5 survives unchanged too (its Time of death picker is the same field)', () => {
    const v5 = standardCremationWorkflowTemplateFixture.versions[1].stages;
    expect(saveAndReload(structuredClone(v5))).toEqual(v5);
  });

  it('a valueKind set or cleared in the editor is exactly what is stored', () => {
    let stages = addChecklistItem(structuredClone(buildGusWorkflowTemplateFixture().versions[0].stages), 0, 'Time of removal');
    stages = updateChecklistItem(stages, 0, 11, { hasField: true, valueKind: 'time' });
    stages = updateChecklistItem(stages, 0, 5, { valueKind: undefined });
    const reloaded = saveAndReload(stages);
    expect(reloaded[0].checklist.items[11]).toMatchObject({ label: 'Time of removal', hasField: true, valueKind: 'time' });
    expect(reloaded[1].checklist.items[11]).toMatchObject({ hasField: false, valueKind: 'time' });
    expect('valueKind' in reloaded[0].checklist.items[5]).toBe(false);
  });

  it('drops an unsupported valueKind (the save still succeeds — Beacon\'s long-standing rule)', () => {
    const stages = structuredClone(buildGusWorkflowTemplateFixture().versions[0].stages) as unknown as { checklist: { items: Record<string, unknown>[] } }[];
    stages[0].checklist.items[5].valueKind = 'date';
    const result = validateWorkflowStagesPayload({ stages });
    expect(result.errors).toEqual([]);
    expect(result.stages?.[0].checklist.items[5]).not.toHaveProperty('valueKind');
  });
});

describe('every ChecklistItemTemplate / StageTemplate field round-trips', () => {
  const full: StageTemplate[] = [
    {
      rawStage: 0,
      displayStage: 0,
      label: 'Intake',
      isAttentionStage: true,
      slaTargetDays: 0.25,
      checklist: {
        items: [
          { index: 0, label: 'Time', hasField: true, isPasswordField: false, externalFormIntegrationId: null, valueKind: 'time' },
          { index: 1, label: 'Masked', hasField: true, isPasswordField: true, externalFormIntegrationId: 'ext-form-1' },
          { index: 2, label: 'Certifier', hasField: false, requiredCaseFields: ['certifierName', 'certifierPhone'] },
          // A minimal item keeps its minimal shape — nothing is added.
          { index: 3, label: 'Plain', hasField: false },
        ],
      },
    },
    { rawStage: 1, displayStage: 1, label: 'Completed', slaTargetDays: null, checklist: { items: [] } },
  ];

  it('keeps each field present-when-present and absent-when-absent', () => {
    const reloaded = saveAndReload(structuredClone(full));
    // externalFormIntegrationId is always written (null when absent) — the
    // shape Beacon has always saved; everything else round-trips exactly.
    const withIntegrationDefault = full.map((stage) => ({
      ...stage,
      checklist: { ...stage.checklist, items: stage.checklist.items.map((item) => ({ externalFormIntegrationId: null, ...item })) },
    }));
    expect(reloaded).toEqual(withIntegrationDefault);
    expect(Object.keys(reloaded[0].checklist.items[3]).sort()).toEqual(['externalFormIntegrationId', 'hasField', 'index', 'label']);
    expect('isAttentionStage' in reloaded[1]).toBe(false);
  });

  it('version metadata (author, proposed service, approval) and the template service assignment round-trip', () => {
    const row = json(
      buildWixWorkflowTemplateVersionData({
        beaconTemplateId: 't',
        version: 3,
        caseTypes: ['burial'],
        stages: full,
        intake: { sections: [] },
        createdAt: '2026-10-15T00:00:00.000Z',
        status: 'draft',
        createdBy: 'identity-x',
        createdByName: 'Example Admin',
        serviceTypeCodes: ['GRAVESIDE_BURIAL_SERVICE_ONLY'],
      }),
    );
    const approved = json(buildApprovedWixWorkflowTemplateVersionData(row, { approvedBy: 'identity-y', approvedAt: '2026-10-16T00:00:00.000Z', approvedByName: 'Example Approver' }));
    expect(mapWixWorkflowTemplateVersionItem(approved)).toMatchObject({
      version: 3,
      status: 'approved',
      createdBy: 'identity-x',
      createdByName: 'Example Admin',
      approvedBy: 'identity-y',
      approvedByName: 'Example Approver',
      serviceTypeCodes: ['GRAVESIDE_BURIAL_SERVICE_ONLY'],
      stages: full,
    });
    // …and the approval patch sets exactly those approval fields.
    expect(buildWixWorkflowTemplateVersionApprovalFields({ approvedBy: 'identity-y', approvedAt: 't' })).toEqual({ status: 'approved', approvedBy: 'identity-y', approvedAt: 't' });
    // A row written without the new fields reads exactly as before.
    const plain = json(buildWixWorkflowTemplateVersionData({ beaconTemplateId: 't', version: 1, caseTypes: ['cremation'], stages: full, intake: { sections: [] }, createdAt: 'x' }));
    expect(Object.keys(plain).sort()).toEqual(['beaconTemplateId', 'caseTypes', 'createdAt', 'intake', 'stages', 'version']);

    const templateRow = buildWixWorkflowTemplateData({ id: 't', organizationId: 'gus-camacho-jr', name: 'Graveside', isEnabled: true, caseTypes: ['burial'], serviceTypeCodes: ['OLD'] });
    // The approve route patches only this one field on the template row.
    const reassigned = { ...templateRow, serviceTypeCodes: ['GRAVESIDE_BURIAL_SERVICE_ONLY'] };
    expect(mapWixWorkflowTemplateItem(json(reassigned))).toEqual({
      id: 't',
      organizationId: 'gus-camacho-jr',
      name: 'Graveside',
      isEnabled: true,
      caseTypes: ['burial'],
      serviceTypeCodes: ['GRAVESIDE_BURIAL_SERVICE_ONLY'],
    });
  });
});
