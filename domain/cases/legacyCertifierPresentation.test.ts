import { describe, expect, it } from 'vitest';
import {
  applyLegacyCertifierPresentation,
  presentedChecklistItemLabel,
  LEGACY_CERTIFIER_ITEM_LABEL,
  CERTIFIER_INFORMATION_LABEL,
} from './legacyCertifierPresentation';
import { getChecklistLabels } from './checklist';
import type { Case } from '../../types/case';
import type { ChecklistItemViewModel } from '../../types/caseViewModel';

/**
 * Legacy Certifier presentation compatibility (2026-09, ADR-041 follow-up).
 * Workflow Template v5 replaced the free-text "Hospice or physician who
 * will sign the DC" checklist item with structured Certifier Information —
 * but every Case created before v5's activation carries a frozen
 * workflowSnapshot (v1-v4) that still literally persists the old label.
 * This module relabels it for staff-facing display only, never rewriting
 * the persisted snapshot.
 */

it('LEGACY_CERTIFIER_ITEM_LABEL matches the actual frozen v1-v4 label — guards against silent drift', () => {
  expect(LEGACY_CERTIFIER_ITEM_LABEL).toBe(getChecklistLabels(0)[6]);
});

function item(overrides: Partial<ChecklistItemViewModel>): ChecklistItemViewModel {
  return {
    index: 6,
    label: LEGACY_CERTIFIER_ITEM_LABEL,
    done: false,
    locked: false,
    hasField: true,
    fieldValue: '',
    fieldIsPassword: false,
    isDerived: false,
    ...overrides,
  };
}

function baseCase(overrides: Partial<Case> = {}): Case {
  return {
    organizationId: 'managed-cremations',
    certifierName: null,
    certifierPhone: null,
    certifierLicenseNumber: null,
    certifierFax: null,
    ...overrides,
  } as Case;
}

describe('presentedChecklistItemLabel', () => {
  it('relabels the legacy Certifier item for managed-cremations', () => {
    expect(presentedChecklistItemLabel(LEGACY_CERTIFIER_ITEM_LABEL, 'managed-cremations')).toBe(
      CERTIFIER_INFORMATION_LABEL,
    );
  });

  it('11. leaves every other label untouched, including unrelated "Hospice" text (e.g. a place-of-death value)', () => {
    expect(presentedChecklistItemLabel('Hillcrest Hospice', 'managed-cremations')).toBe('Hillcrest Hospice');
    expect(presentedChecklistItemLabel('Payment collected', 'managed-cremations')).toBe('Payment collected');
  });

  it('is a no-op for any other organization', () => {
    expect(presentedChecklistItemLabel(LEGACY_CERTIFIER_ITEM_LABEL, 'evergreen-memorial-group')).toBe(
      LEGACY_CERTIFIER_ITEM_LABEL,
    );
  });
});

describe('applyLegacyCertifierPresentation', () => {
  it('1/2. relabels the legacy item to "Certifier Information", never showing the Hospice/physician wording', () => {
    const case_ = baseCase();
    const items = [item({})];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    expect(result[0].label).toBe('Certifier Information');
    expect(result[0].label).not.toContain('Hospice');
  });

  it('Task #7 follow-up (2026-09): a case with no structured certifier data preserves the exact existing done/locked state, but now presents the structured Name+Phone editor — never the raw legacy fieldValues box', () => {
    const case_ = baseCase();
    const items = [item({ done: true, locked: false, hasField: true, fieldValue: 'Dr. Choi — 555-0100', isDerived: false })];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    // done/locked preserved byte-for-byte — this fix must never itself flip
    // an existing case's completion state.
    expect(result[0]).toMatchObject({ done: true, locked: false });
    // The editing surface changes: no longer the raw legacy free-text box.
    expect(result[0].hasField).toBe(false);
    expect(result[0].fieldValue).toBe('');
    expect(result[0].isDerived).toBe(true);
    expect(result[0].requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
    expect(result[0].requiredCaseFieldValues).toEqual({ certifierName: '', certifierPhone: '' });
  });

  it('does not silently copy the old dcContact fieldValue into structured Case fields — untouched by this presentation layer', () => {
    const case_ = baseCase();
    const items = [item({ fieldValue: 'Dr. Choi — 555-0100' })];
    applyLegacyCertifierPresentation(items, case_, false);
    expect(case_.certifierName).toBeNull();
    expect(case_.certifierPhone).toBeNull();
  });

  it('Task #7 follow-up: the legacy fieldValue is left completely untouched (never read into requiredCaseFieldValues) even though the item no longer displays it', () => {
    const case_ = baseCase();
    const items = [item({ fieldValue: 'Dr. Choi — 555-0100' })];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    expect(result[0].requiredCaseFieldValues).toEqual({ certifierName: '', certifierPhone: '' });
  });

  it('Task #7 follow-up: once structured data exists, requiredCaseFieldValues reflects the real Case.certifierName/certifierPhone values', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    const items = [item({})];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    expect(result[0].requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
    expect(result[0].requiredCaseFieldValues).toEqual({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
  });

  it('Task #7 reopened, second follow-up (2026-09): a past-stage view ALSO shows the structured Name+Phone editor — never the raw legacy fieldValue box (the real Manors case is viewed this way once it advances past the First Call & Payment stage)', () => {
    const case_ = baseCase();
    const items = [item({ done: true, locked: false, hasField: true, fieldValue: 'Dr. Choi — 555-0100', isDerived: false })];
    const result = applyLegacyCertifierPresentation(items, case_, true);
    // done/locked are exactly what resolveChecklist already computed for a
    // past stage (done-by-definition, never relocked) — untouched here.
    expect(result[0].done).toBe(true);
    expect(result[0].locked).toBe(false);
    // The editing surface is the live structured editor, same as the
    // current-stage "no structured data yet" case — Certifier Name/Phone
    // are current Case data, not part of the frozen stage snapshot.
    expect(result[0].hasField).toBe(false);
    expect(result[0].fieldValue).toBe('');
    expect(result[0].requiredCaseFields).toEqual(['certifierName', 'certifierPhone']);
    expect(result[0].requiredCaseFieldValues).toEqual({ certifierName: '', certifierPhone: '' });
  });

  it('Task #7 reopened: the legacy fieldValue is never read into requiredCaseFieldValues on a past-stage view either — DR.SID must never be guessed as the Certifier Name', () => {
    const case_ = baseCase();
    const items = [item({ fieldValue: 'DR.SID' })];
    const result = applyLegacyCertifierPresentation(items, case_, true);
    expect(result[0].requiredCaseFieldValues).toEqual({ certifierName: '', certifierPhone: '' });
    expect(case_.certifierName).toBeNull();
  });

  it('Task #7 reopened: once structured data exists, a past-stage view reflects the real values too', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    const items = [item({ done: true, locked: false })];
    const result = applyLegacyCertifierPresentation(items, case_, true);
    expect(result[0].done).toBe(true); // untouched — still done-by-definition, not recomputed
    expect(result[0].requiredCaseFieldValues).toEqual({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
  });

  it('3. an old dcContact value alone never marks the item done via the new rule (Name only present is still incomplete)', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: null });
    const items = [item({ done: false })];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    expect(result[0].done).toBe(false);
  });

  it('3. Phone only present is still incomplete', () => {
    const case_ = baseCase({ certifierName: null, certifierPhone: '555-0199' });
    const items = [item({ done: false })];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    expect(result[0].done).toBe(false);
  });

  it('3. Name + Phone present -> complete, once structured data exists on a legacy case', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    const items = [item({ done: false })];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    expect(result[0].done).toBe(true);
    expect(result[0].isDerived).toBe(true);
    expect(result[0].hasField).toBe(false);
  });

  it('4/5. certifierLicenseNumber/certifierFax never block completion once Name+Phone are present', () => {
    const case_ = baseCase({
      certifierName: 'DR. JANE FOSTER',
      certifierPhone: '555-0199',
      certifierLicenseNumber: null,
      certifierFax: null,
    });
    const items = [item({ done: false })];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    expect(result[0].done).toBe(true);
  });

  it('recomputes the next item\'s locked state to stay consistent with the new done value', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    const items = [item({ done: false }), { index: 7, label: 'Family contact', done: false, locked: true, hasField: true, fieldValue: '', fieldIsPassword: false, isDerived: false }];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    expect(result[1].locked).toBe(false);
  });

  it('the next item locks again if structured data is present but incomplete', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: null });
    const items = [item({ done: false }), { index: 7, label: 'Family contact', done: false, locked: false, hasField: true, fieldValue: '', fieldIsPassword: false, isDerived: false }];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    expect(result[1].locked).toBe(true);
  });

  it('8. a legacy workflowSnapshot can be displayed with current terminology even when structured data exists', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    const result = applyLegacyCertifierPresentation([item({})], case_, false);
    expect(result[0].label).toBe('Certifier Information');
  });

  it('skips the done/locked upgrade for a past-stage view even with structured data present — label relabels and the editing surface is structured, but done/locked stay exactly as resolveChecklist already computed', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    const items = [item({ done: true, locked: false, hasField: true })]; // isPastStage forces done:true upstream already
    const result = applyLegacyCertifierPresentation(items, case_, true);
    expect(result[0].label).toBe('Certifier Information');
    expect(result[0].done).toBe(true); // untouched — never recomputed for a past-stage view
    expect(result[0].hasField).toBe(false); // Task #7 reopened: structured editor, not the old free-text box
    expect(result[0].requiredCaseFieldValues).toEqual({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
  });

  it('is a no-op for a v5+ Case whose item is already labeled "Certifier Information"', () => {
    const case_ = baseCase();
    const items = [item({ label: 'Certifier Information', hasField: false })];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    expect(result).toBe(items); // same reference — untouched
  });

  it('9. never mutates the input item list or its objects', () => {
    const case_ = baseCase({ certifierName: 'DR. JANE FOSTER', certifierPhone: '555-0199' });
    const items = [item({})];
    const originalItem = items[0];
    applyLegacyCertifierPresentation(items, case_, false);
    expect(items[0]).toBe(originalItem);
    expect(originalItem.label).toBe(LEGACY_CERTIFIER_ITEM_LABEL);
  });

  it('is a no-op for a different organization\'s Case, even with the exact legacy label present', () => {
    const case_ = baseCase({ organizationId: 'evergreen-memorial-group' });
    const items = [item({})];
    const result = applyLegacyCertifierPresentation(items, case_, false);
    expect(result).toBe(items);
  });
});
