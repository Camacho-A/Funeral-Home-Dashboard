import { describe, expect, it } from 'vitest';
import { standardCremationWorkflowTemplateFixture } from './workflowTemplates';

/**
 * Manual-checklist-item fix (2026-09). `buildChecklistItems`'s `hasField`
 * computation previously excluded only "Payment collected" — leaving
 * "Credit card payment collected by phone" and "Payment receipt sent"
 * incorrectly marked as field-backed, even though no intake field or
 * import path has ever populated a fieldValues index for either. Asserts
 * the corrected exclusion set directly against the real exported fixture
 * (never a re-implementation of the logic under test).
 */
function stage0Items() {
  const stage0 = standardCremationWorkflowTemplateFixture.versions[0].stages.find((s) => s.rawStage === 0);
  if (!stage0) throw new Error('rawStage 0 not found in fixture — test setup is broken.');
  return stage0.checklist.items;
}

describe('buildChecklistItems — manual vs. field-backed classification (2026-09 fix)', () => {
  it('"Payment collected" remains hasField: false (unchanged, pre-existing behavior)', () => {
    const item = stage0Items().find((i) => i.label === 'Payment collected');
    expect(item?.hasField).toBe(false);
  });

  it('"Credit card payment collected by phone" is hasField: false (fixed — was incorrectly true)', () => {
    const item = stage0Items().find((i) => i.label === 'Credit card payment collected by phone');
    expect(item).toBeDefined();
    expect(item?.hasField).toBe(false);
  });

  it('"Payment receipt sent — confirms cleared to dispatch" is hasField: false (fixed — was incorrectly true)', () => {
    const item = stage0Items().find((i) => i.label === 'Payment receipt sent — confirms cleared to dispatch');
    expect(item).toBeDefined();
    expect(item?.hasField).toBe(false);
  });

  it('every genuine data-entry item in Step 1 remains hasField: true (unaffected by this fix)', () => {
    const dataEntryLabels = [
      'Name of deceased',
      'Place of death — name, address & phone number',
      'Date of birth',
      'Weight',
      'Date of death',
      'Time of death',
      'Hospice or physician who will sign the DC — name & phone number',
      'Family contact — name, phone number & email',
    ];
    for (const label of dataEntryLabels) {
      const item = stage0Items().find((i) => i.label === label);
      expect(item?.hasField, `expected "${label}" to remain hasField: true`).toBe(true);
    }
  });
});

/**
 * Structured Certifier data (2026-09, ADR-041) — workflow template version
 * 5, appended as a new versions[] entry. v1 (versions[0]) must remain
 * byte-for-byte untouched — existing frozen case workflowSnapshots built
 * from it must never see the new Certifier model.
 */
function v5() {
  const version = standardCremationWorkflowTemplateFixture.versions.find((v) => v.version === 5);
  if (!version) throw new Error('version 5 not found in fixture — test setup is broken.');
  return version;
}

function v5Stage(rawStage: number) {
  const stage = v5().stages.find((s) => s.rawStage === rawStage);
  if (!stage) throw new Error(`rawStage ${rawStage} not found in v5 — test setup is broken.`);
  return stage.checklist.items;
}

describe('standardCremationWorkflowTemplateFixture — version 5 (Structured Certifier data, 2026-09, ADR-041)', () => {
  it('20. version 1 is completely untouched — same label at index 6, no requiredCaseFields/valueKind anywhere', () => {
    const v1Items = stage0Items();
    expect(v1Items[6].label).toBe('Hospice or physician who will sign the DC — name & phone number');
    expect(v1Items[6].requiredCaseFields).toBeUndefined();
    expect(v1Items[5].valueKind).toBeUndefined();
    for (const item of v1Items) {
      expect(item.requiredCaseFields).toBeUndefined();
      expect(item.valueKind).toBeUndefined();
    }
  });

  it('21. version 5 exists as a second, later versions[] entry (append-only, never replacing v1)', () => {
    expect(standardCremationWorkflowTemplateFixture.versions).toHaveLength(2);
    expect(standardCremationWorkflowTemplateFixture.versions[0].version).toBe(1);
    expect(v5().version).toBe(5);
  });

  it('22. v5 rawStage 0 index 6 is "Certifier Information": hasField false, requiredCaseFields [certifierName, certifierPhone]', () => {
    const items = v5Stage(0);
    expect(items[6].label).toBe('Certifier Information');
    expect(items[6].hasField).toBe(false);
    expect(items[6].requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
    expect(items[6].externalFormIntegrationId).toBeNull();
  });

  it('23. v5 rawStage 1 (the isFirstCallStage(1)===false mirror) has the same Certifier Information override at index 6', () => {
    const items = v5Stage(1);
    expect(items[6].label).toBe('Certifier Information');
    expect(items[6].hasField).toBe(false);
    expect(items[6].requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
  });

  it('24. v5 index 5 (Time of death) gains valueKind: "time", label/hasField unchanged', () => {
    const items = v5Stage(0);
    expect(items[5].label).toBe('Time of death');
    expect(items[5].hasField).toBe(true);
    expect(items[5].valueKind).toBe('time');
  });

  it('25. every v5 rawStage other than 0/1 is deep-equal to its v1 counterpart — the override is scoped, not global', () => {
    for (let rawStage = 2; rawStage < 8; rawStage++) {
      const v1Stage = standardCremationWorkflowTemplateFixture.versions[0].stages.find((s) => s.rawStage === rawStage);
      const v5StageEntry = v5().stages.find((s) => s.rawStage === rawStage);
      expect(v5StageEntry?.checklist.items).toEqual(v1Stage?.checklist.items);
    }
  });

  it('26. v5 intake replaces dcContact with 4 certifier fields, none carrying a checklistItemIndex', () => {
    const contactsSection = v5().intake.sections.find((s) => s.key === 'contacts');
    expect(contactsSection).toBeDefined();
    const keys = contactsSection!.fields.map((f) => f.key);
    expect(keys).not.toContain('dcContact');
    expect(keys).toEqual(expect.arrayContaining(['certifierName', 'certifierPhone', 'certifierLicenseNumber', 'certifierFax']));
    for (const key of ['certifierName', 'certifierPhone', 'certifierLicenseNumber', 'certifierFax']) {
      const field = contactsSection!.fields.find((f) => f.key === key);
      expect(field?.checklistItemIndex).toBeUndefined();
    }
  });

  it('27. certifierName/certifierPhone are not required at the intake level — checklist completion, not New Case submission, gates them', () => {
    const contactsSection = v5().intake.sections.find((s) => s.key === 'contacts');
    const name = contactsSection!.fields.find((f) => f.key === 'certifierName');
    const phone = contactsSection!.fields.find((f) => f.key === 'certifierPhone');
    expect(name?.required).not.toBe(true);
    expect(phone?.required).not.toBe(true);
  });

  it('28. v5 intake keeps nextOfKinName/nextOfKinPhone unchanged (still checklistItemIndex 7)', () => {
    const contactsSection = v5().intake.sections.find((s) => s.key === 'contacts');
    const name = contactsSection!.fields.find((f) => f.key === 'nextOfKinName');
    const phone = contactsSection!.fields.find((f) => f.key === 'nextOfKinPhone');
    expect(name?.checklistItemIndex).toBe(7);
    expect(phone?.checklistItemIndex).toBe(7);
  });

  it('29. v5 decedent and payment sections are unchanged from v1', () => {
    const v1Intake = standardCremationWorkflowTemplateFixture.versions[0].intake;
    expect(v5().intake.sections.find((s) => s.key === 'decedent')).toEqual(v1Intake.sections.find((s) => s.key === 'decedent'));
    expect(v5().intake.sections.find((s) => s.key === 'payment')).toEqual(v1Intake.sections.find((s) => s.key === 'payment'));
  });
});
