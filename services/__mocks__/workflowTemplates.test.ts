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
