import { afterEach, describe, expect, it } from 'vitest';
import { caseRevision } from '../lib/wixCaseMapper';
import { casesService } from './casesService';
import { computeFirstIncompleteRawStage } from './workflowReconciliationService';
import { caseFixtures, DEFAULT_ORGANIZATION_ID } from './__mocks__/fixtures';
import { SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { standardCremationWorkflowTemplateFixture, CERTIFIER_FAX_REQUIRED_CASE_FIELDS } from './__mocks__/workflowTemplates';
import { buildCaseWorkflowSnapshot, latestTemplateVersion } from '../domain/workflow/snapshot';
import { resolveChecklist } from '../domain/workflow/resolveChecklist';
import { buildCaseViewModel } from '../domain/cases/viewModel';
import { touchesWorkflowCompletion } from '../domain/cases/workflowCompletion';
import { classifyReconciliationRow } from '../domain/externalForms/reconciliation';
import { requiredCaseFieldsSummary } from '../domain/workflow/requiredCaseFieldLabels';
import type { Case } from '../types/case';
import type { CaseWorkflowSnapshot, WorkflowTemplateVersion } from '../types/workflowTemplate';

/**
 * Certifier fax (2026-10, workflow template v7).
 *
 * New cases' Certifier Information item is completed by Name + FAX. Which
 * rule a case uses is decided by its OWN frozen workflow snapshot — never
 * by a date or the deployment — so every case created under v1-v6 keeps
 * exactly the completion rule it was created with.
 */

const template = standardCremationWorkflowTemplateFixture;

/** Case concurrency (2026-10): a save is always made against the revision of
    the case as the caller last saw it — here, the case's current revision. */
function updateAtCurrentRevision(
  context: { organizationId: string },
  caseId: string,
  patch: Parameters<typeof casesService.update>[2],
  mode?: Parameters<typeof casesService.update>[3],
) {
  const current = caseFixtures.find((c) => c.id === caseId && c.organizationId === context.organizationId);
  return casesService.update(context as Parameters<typeof casesService.update>[0], caseId, patch, mode, {
    expectedRevision: current ? caseRevision(current) : 0,
  });
}
const versionOf = (n: number) => template.versions.find((v) => v.version === n)!;

/** Live template v6's shape: v5 with `requiredCaseFields` stripped from the
    Certifier item by the (since-fixed) mapper defect. Not in the mock
    fixture, so derived here. */
function v6ShapeSnapshot(): CaseWorkflowSnapshot {
  const v5 = buildCaseWorkflowSnapshot(template, versionOf(5));
  return {
    ...v5,
    workflowTemplateVersion: 6,
    stages: v5.stages.map((stage) => ({
      ...stage,
      checklist: {
        items: stage.checklist.items.map((item) => {
          if (item.index !== 6 || stage.rawStage > 1) return item;
          const stripped = { ...item };
          delete stripped.requiredCaseFields;
          return stripped;
        }),
      },
    })),
  };
}

type Shape = 'v1' | 'v5' | 'v6' | 'v7';
function snapshotFor(shape: Shape): { version: number; snapshot: CaseWorkflowSnapshot } {
  if (shape === 'v6') return { version: 6, snapshot: v6ShapeSnapshot() };
  const version: WorkflowTemplateVersion = versionOf(Number(shape.slice(1)));
  return { version: version.version, snapshot: buildCaseWorkflowSnapshot(template, version) };
}

function buildCase(shape: Shape, overrides: Partial<Case> = {}): Case {
  const { version, snapshot } = snapshotFor(shape);
  return {
    ...caseFixtures[0],
    id: `certifier-fax-${shape}-${Math.random().toString(36).slice(2)}`,
    organizationId: DEFAULT_ORGANIZATION_ID,
    rawStage: 0,
    certifierName: null,
    certifierPhone: null,
    certifierLicenseNumber: null,
    certifierFax: null,
    checklistState: {},
    fieldValues: {},
    paymentStatus: 'awaiting_payment',
    isMedicalExaminerCase: false,
    workflowTemplateId: template.id,
    workflowTemplateVersion: version,
    workflowSnapshot: snapshot,
    ...overrides,
  };
}

function certifierItem(case_: Case) {
  const items = case_.workflowSnapshot!.stages.find((s) => s.rawStage === case_.rawStage)!.checklist.items;
  return resolveChecklist(items, 0, case_).find((item) => item.index === 6)!;
}

/** Every First Call & Payment item satisfied EXCEPT what certifier data
    the caller supplies — so stage advancement turns on the certifier rule
    alone. */
function intakeOtherwiseComplete(): Partial<Case> {
  const checklistState: Record<string, boolean> = {};
  for (let i = 0; i <= 10; i++) checklistState[`0:${i}`] = true;
  return {
    fieldValues: { 0: 'X', 1: 'X', 2: 'X', 3: 'X', 4: 'X', 5: 'X', 6: 'X', 7: 'X' },
    checklistState,
    nextOfKinName: 'TEST NOK',
    nextOfKinPhone: '555-0100',
    paymentStatus: 'paid_in_full',
  };
}

const NAME = 'DR. JANE FOSTER';
const PHONE = '555-0199';
const FAX = '555-0188';

describe('template v7 — the version new cases are created from', () => {
  it('is the latest version, and its Certifier item requires Name + Fax at both First Call raw stages', () => {
    const latest = latestTemplateVersion(template);
    expect(latest.version).toBe(7);
    for (const rawStage of [0, 1]) {
      const item = latest.stages.find((s) => s.rawStage === rawStage)!.checklist.items[6];
      expect(item.label).toBe('Certifier Information');
      expect(item.requiredCaseFields).toEqual(CERTIFIER_FAX_REQUIRED_CASE_FIELDS);
      expect(item.requiredCaseFields).not.toContain('certifierPhone');
    }
  });

  it('changes nothing else relative to v5', () => {
    const withoutRequiredFields = (item: WorkflowTemplateVersion['stages'][number]['checklist']['items'][number]) => {
      const copy = { ...item };
      delete copy.requiredCaseFields;
      return copy;
    };
    const strip = (v: WorkflowTemplateVersion) =>
      v.stages.map((s) => ({ ...s, checklist: { items: s.checklist.items.map(withoutRequiredFields) } }));
    expect(strip(versionOf(7))).toEqual(strip(versionOf(5)));
    expect(versionOf(7).intake).toEqual(versionOf(5).intake);
  });

  it('a new case created through casesService.create is frozen on v7', async () => {
    const created = await casesService.create(
      { organizationId: DEFAULT_ORGANIZATION_ID },
      { decedentName: 'Fax Template Test', nextOfKinName: '', nextOfKinPhone: '' },
      { staffId: 'staff-1', organizationId: DEFAULT_ORGANIZATION_ID } as never,
      template,
    );
    try {
      expect(created.workflowTemplateVersion).toBe(7);
      expect(certifierItem(created).requiredCaseFields).toEqual(['certifierName', 'certifierFax']);
    } finally {
      caseFixtures.splice(caseFixtures.findIndex((c) => c.id === created.id), 1);
    }
  });
});

describe('new (v7) cases use the fax', () => {
  it('Name + Fax completes the item', () => {
    expect(certifierItem(buildCase('v7', { certifierName: NAME, certifierFax: FAX })).done).toBe(true);
  });

  it('Name + Phone without a fax does NOT complete it', () => {
    expect(certifierItem(buildCase('v7', { certifierName: NAME, certifierPhone: PHONE })).done).toBe(false);
  });

  it('a manually ticked checklist state cannot stand in for the fax', () => {
    expect(certifierItem(buildCase('v7', { certifierName: NAME, checklistState: { '0:6': true } })).done).toBe(false);
  });

  it('the item reads and edits the FAX value, not the phone', () => {
    const item = certifierItem(buildCase('v7', { certifierName: NAME, certifierPhone: PHONE, certifierFax: FAX }));
    expect(item.requiredCaseFieldValues).toEqual({ certifierName: NAME, certifierFax: FAX });
    expect(item.requiredCaseFieldValues).not.toHaveProperty('certifierPhone');
  });

  it('the view model shows the fax editor and no Manors compatibility layer overrides it', () => {
    const vm = buildCaseViewModel(buildCase('v7', { certifierName: NAME, certifierPhone: PHONE }), { staffList: [] });
    const item = vm.checklist.find((i) => i.index === 6)!;
    // Manors upper-cases intake labels for display.
    expect(item.label.toLowerCase()).toBe('certifier information');
    expect(item.requiredCaseFields).toEqual(['certifierName', 'certifierFax']);
    expect(item.done).toBe(false);
  });

  it('blocks the intake stage until the fax is present, then lets it advance', () => {
    const withoutFax = buildCase('v7', { ...intakeOtherwiseComplete(), certifierName: NAME, certifierPhone: PHONE });
    expect(computeFirstIncompleteRawStage(withoutFax, false)).toBe(0);
    const withFax = { ...withoutFax, certifierFax: FAX };
    expect(computeFirstIncompleteRawStage(withFax, false)).toBe(2);
  });
});

describe('existing (v1-v6) cases keep their original rule', () => {
  const shapes: Shape[] = ['v1', 'v5', 'v6'];

  it.each(shapes)('%s: Name + Phone with NO fax stays complete', (shape) => {
    const case_ = buildCase(shape, {
      certifierName: NAME,
      certifierPhone: PHONE,
      // v1's free-text item is completed by its own fieldValues entry.
      fieldValues: shape === 'v1' ? { 6: 'DR. JANE FOSTER 555-0199' } : {},
    });
    expect(certifierItem(case_).done).toBe(true);
  });

  it.each(shapes)('%s: a fax alone never becomes the requirement', (shape) => {
    expect(certifierItem(buildCase(shape, { certifierName: NAME, certifierFax: FAX })).done).toBe(false);
  });

  it('v5: still declares and edits Name + Phone', () => {
    const item = certifierItem(buildCase('v5', { certifierName: NAME, certifierPhone: PHONE }));
    expect(item.requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
    expect(item.requiredCaseFieldValues).toEqual({ certifierName: NAME, certifierPhone: PHONE });
  });

  it('v6 (live, stripped item): the Manors view still presents the Name + Phone editor', () => {
    const vm = buildCaseViewModel(buildCase('v6', { certifierName: NAME, certifierPhone: PHONE }), { staffList: [] });
    const item = vm.checklist.find((i) => i.index === 6)!;
    expect(item.requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
    expect(item.done).toBe(true);
  });

  it.each(shapes)('%s: a case with phone but no fax still advances through its original workflow', (shape) => {
    const case_ = buildCase(shape, { ...intakeOtherwiseComplete(), certifierName: NAME, certifierPhone: PHONE });
    expect(computeFirstIncompleteRawStage(case_, false)).toBe(2);
  });

  it.each(shapes)('%s: a case already past intake is never pulled back, even with no certifier data at all', (shape) => {
    const case_ = buildCase(shape, { rawStage: 3 });
    expect(computeFirstIncompleteRawStage(case_, false)).toBeGreaterThanOrEqual(3);
    const items = case_.workflowSnapshot!.stages.find((s) => s.rawStage === 0)!.checklist.items;
    // The past stage shows what is really missing (2026-10) — and staff can
    // complete it there — but the case is never moved back to it.
    const past = resolveChecklist(items, 0, case_, { isPastStage: true });
    expect(past.some((i) => !i.done)).toBe(true);
    expect(past.every((i) => !i.locked)).toBe(true);
  });
});

describe('editing the fax', () => {
  afterEach(() => {
    for (let i = caseFixtures.length - 1; i >= 0; i--) {
      if (caseFixtures[i].id.startsWith('certifier-fax-')) caseFixtures.splice(i, 1);
    }
  });

  it('counts as a completion-affecting edit, so the stage re-evaluates', () => {
    expect(touchesWorkflowCompletion({ certifierFax: FAX })).toBe(true);
  });

  it('saving the fax on a v7 case advances it, and leaves the stored phone untouched', async () => {
    const case_ = buildCase('v7', { ...intakeOtherwiseComplete(), certifierName: NAME, certifierPhone: PHONE });
    caseFixtures.push(case_);

    const updated = await updateAtCurrentRevision({ organizationId: DEFAULT_ORGANIZATION_ID }, case_.id, { certifierFax: FAX });

    expect(updated.certifierFax).toBe(FAX);
    expect(updated.certifierPhone).toBe(PHONE);
    expect(updated.rawStage).toBe(2);
  });

  it('saving a fax on a legacy case changes nothing about its progress or its phone', async () => {
    const case_ = buildCase('v6', { ...intakeOtherwiseComplete(), rawStage: 3, certifierName: NAME, certifierPhone: PHONE });
    caseFixtures.push(case_);

    const updated = await updateAtCurrentRevision({ organizationId: DEFAULT_ORGANIZATION_ID }, case_.id, { certifierFax: FAX });

    expect(updated.rawStage).toBe(3);
    expect(updated.certifierPhone).toBe(PHONE);
    expect(updated.checklistState).toEqual(case_.checklistState);
  });

  it('another organization cannot write the fax onto this case', async () => {
    const case_ = buildCase('v7', { certifierName: NAME });
    caseFixtures.push(case_);

    await expect(
      updateAtCurrentRevision({ organizationId: SECOND_MOCK_ORGANIZATION_ID }, case_.id, { certifierFax: FAX }),
    ).rejects.toThrow(/not found/);
    expect(caseFixtures.find((c) => c.id === case_.id)!.certifierFax).toBeNull();
  });
});

describe('JotForm Arrangement fax onto an existing case (review)', () => {
  it('is offered when the case has no fax', () => {
    expect(classifyReconciliationRow('certifierFax', null, '954-777-2262')).toMatchObject({ state: 'solis_empty', eligibleForBulkApply: true });
  });

  it('never silently replaces a different fax already on the case', () => {
    expect(classifyReconciliationRow('certifierFax', '954-000-0000', '954-777-2262')).toMatchObject({ state: 'conflict', eligibleForBulkApply: false });
  });

  it('the rest of the certifier block is offered the same way (2026-10) — no longer review-only', () => {
    expect(classifyReconciliationRow('certifierPhone', null, '954-777-0000').state).toBe('solis_empty');
    expect(classifyReconciliationRow('certifierName', null, 'DR. ROWAN EASTWICK').state).toBe('solis_empty');
    expect(classifyReconciliationRow('certifierLicenseNumber', null, 'ME-40211').state).toBe('solis_empty');
  });
});

describe('Workflow Editor summary', () => {
  it('names what completes each derived item, so v7 is distinguishable from v6', () => {
    expect(requiredCaseFieldsSummary(['certifierName', 'certifierFax'])).toBe('Certifier name + Certifier fax');
    expect(requiredCaseFieldsSummary(undefined)).toBeNull();
    expect(requiredCaseFieldsSummary([])).toBeNull();
  });
});
