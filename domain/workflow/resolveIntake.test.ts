import { describe, expect, it } from 'vitest';
import { buildIntakeFieldValues, buildStructuredCaseFields } from './resolveIntake';
import type { IntakeTemplate } from '../../types/workflowTemplate';

/**
 * Phase 19A (Secure Payment Architecture). These tests exist specifically
 * to prove the hard, defense-in-depth guarantee documented on both
 * functions below: a fieldType 'payment' field's value can never surface
 * in either function's output, even if the caller's `draft` contains one
 * (which NewCaseModal.tsx never actually does — see its own comment — but
 * this guarantees it independently of that).
 */

const INTAKE_WITH_PAYMENT: IntakeTemplate = {
  sections: [
    {
      key: 'decedent',
      label: 'Decedent',
      fields: [{ key: 'decedentName', label: 'Name', checklistItemIndex: 0, mapsToCaseField: 'decedentName' }],
    },
    {
      key: 'payment',
      label: 'Payment',
      fields: [
        {
          key: 'payment',
          label: 'Payment',
          fieldType: 'payment',
          // A payment field has no checklistItemIndex/mapsToCaseField in
          // practice — but the skip in resolveIntake.ts checks fieldType
          // first, so even a forged template configuring one anyway must
          // still never surface it.
          checklistItemIndex: 8,
          mapsToCaseField: 'cardNumber',
        },
      ],
    },
  ],
};

describe('buildIntakeFieldValues — payment field exclusion (Phase 19A)', () => {
  it('never includes a payment field value, even if draft contains one under its key', () => {
    const draft = { decedentName: 'Jane Doe', payment: '4111111111111111 — 12/28 — 123' };
    const result = buildIntakeFieldValues(INTAKE_WITH_PAYMENT, draft);
    expect(result).toEqual({ 0: 'Jane Doe' });
  });

  it('never includes a payment field value even when the forged template gives it a checklistItemIndex matching another field', () => {
    const collidingIntake: IntakeTemplate = {
      sections: [
        ...INTAKE_WITH_PAYMENT.sections.slice(0, 1),
        {
          key: 'payment',
          label: 'Payment',
          fields: [{ key: 'payment', label: 'Payment', fieldType: 'payment', checklistItemIndex: 0 }],
        },
      ],
    };
    const result = buildIntakeFieldValues(collidingIntake, { decedentName: 'Jane Doe', payment: '4111 1111 1111 1111' });
    // Only the legitimate decedentName value reaches index 0 — the payment
    // field's value is never joined in, even though it shares the index.
    expect(result[0]).toBe('Jane Doe');
  });

  it('leaves non-payment fields completely unaffected', () => {
    const intake: IntakeTemplate = {
      sections: [
        {
          key: 's',
          label: 'S',
          fields: [
            { key: 'a', label: 'A', checklistItemIndex: 0 },
            { key: 'b', label: 'B', checklistItemIndex: 0 },
            { key: 'c', label: 'C', checklistItemIndex: 1 },
          ],
        },
      ],
    };
    const result = buildIntakeFieldValues(intake, { a: 'first', b: 'second', c: 'third' });
    expect(result).toEqual({ 0: 'first — second', 1: 'third' });
  });
});

describe('buildStructuredCaseFields — payment field exclusion (Phase 19A)', () => {
  it('never includes a payment field value, even if a forged template gives it a mapsToCaseField', () => {
    const draft = { decedentName: 'Jane Doe', payment: '4111111111111111' };
    const result = buildStructuredCaseFields(INTAKE_WITH_PAYMENT, draft);
    expect(result).toEqual({ decedentName: 'Jane Doe' });
    expect(result.cardNumber).toBeUndefined();
  });

  it('leaves non-payment mapsToCaseField fields completely unaffected', () => {
    const intake: IntakeTemplate = {
      sections: [
        {
          key: 's',
          label: 'S',
          fields: [
            { key: 'decedentName', label: 'Name', mapsToCaseField: 'decedentName' },
            { key: 'weight', label: 'Weight', mapsToCaseField: 'weight' },
          ],
        },
      ],
    };
    const result = buildStructuredCaseFields(intake, { decedentName: 'Jane Doe', weight: '150 lb' });
    expect(result).toEqual({ decedentName: 'Jane Doe', weight: '150 lb' });
  });
});
