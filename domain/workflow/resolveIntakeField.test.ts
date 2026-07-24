import { describe, expect, it } from 'vitest';
import { resolveIntakeField, resolveSectionFields } from './resolveIntakeField';
import type { IntakeFieldTemplate, IntakeSectionTemplate } from '../../types/workflowTemplate';

describe('resolveIntakeField — defaults for a pre-Phase-19 record', () => {
  it('defaults fieldType to text, everything else to its safe default', () => {
    const field: IntakeFieldTemplate = { key: 'dcContact', label: 'DC contact' };
    const resolved = resolveIntakeField(field, 3);

    expect(resolved).toEqual({
      key: 'dcContact',
      label: 'DC contact',
      placeholder: undefined,
      checklistItemIndex: undefined,
      mapsToCaseField: undefined,
      fieldType: 'text',
      required: false,
      defaultValue: '',
      displayOrder: 3,
      uppercase: false,
      masked: false,
      multiline: false,
      validationType: 'none',
      options: [],
      paymentPurpose: '',
      paymentAmount: '',
      paymentDescription: '',
    });
  });

  it('falls back to the legacy `password` flag for masking when `masked` is unset', () => {
    const field: IntakeFieldTemplate = { key: 'cardNumber', label: 'Card number', password: true };
    expect(resolveIntakeField(field, 0).masked).toBe(true);
  });

  it('prefers the new `masked` flag over the legacy `password` flag when both are present', () => {
    const field: IntakeFieldTemplate = { key: 'x', label: 'X', password: true, masked: false };
    expect(resolveIntakeField(field, 0).masked).toBe(false);
  });

  it('derives multiline from fieldType, ignoring any stored multiline value', () => {
    const textarea: IntakeFieldTemplate = { key: 'x', label: 'X', fieldType: 'textarea', multiline: false };
    const text: IntakeFieldTemplate = { key: 'y', label: 'Y', fieldType: 'text', multiline: true };
    expect(resolveIntakeField(textarea, 0).multiline).toBe(true);
    expect(resolveIntakeField(text, 0).multiline).toBe(false);
  });

  it('uses the field its own displayOrder when explicitly set, not the array index', () => {
    const field: IntakeFieldTemplate = { key: 'x', label: 'X', displayOrder: 7 };
    expect(resolveIntakeField(field, 0).displayOrder).toBe(7);
  });

  it('Phase 19.1: defaults validationType to "time" for a time field with no explicit validationType', () => {
    const field: IntakeFieldTemplate = { key: 'timeOfDeath', label: 'Time of death', fieldType: 'time' };
    expect(resolveIntakeField(field, 0).validationType).toBe('time');
  });

  it('Phase 19.1: an explicit validationType on a time field still wins over the "time" default', () => {
    const field: IntakeFieldTemplate = {
      key: 'x',
      label: 'X',
      fieldType: 'time',
      validationType: 'none',
    };
    expect(resolveIntakeField(field, 0).validationType).toBe('none');
  });

  it('Phase 19.1: a non-time field never gets the "time" validationType default', () => {
    const field: IntakeFieldTemplate = { key: 'x', label: 'X', fieldType: 'text' };
    expect(resolveIntakeField(field, 0).validationType).toBe('none');
  });

  it('passes through explicitly configured Phase 19 properties unchanged', () => {
    const field: IntakeFieldTemplate = {
      key: 'email',
      label: 'Email',
      fieldType: 'email',
      required: true,
      validationType: 'email',
      uppercase: false,
      options: [],
    };
    const resolved = resolveIntakeField(field, 0);
    expect(resolved.fieldType).toBe('email');
    expect(resolved.required).toBe(true);
    expect(resolved.validationType).toBe('email');
  });
});

describe('resolveSectionFields — ordering', () => {
  function section(fields: IntakeFieldTemplate[]): IntakeSectionTemplate {
    return { key: 's', label: 'Section', fields };
  }

  it('preserves array order for fields with no explicit displayOrder (pre-Phase-19 data)', () => {
    const result = resolveSectionFields(section([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]));
    expect(result.map((f) => f.key)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by explicit displayOrder when present, overriding array position', () => {
    const result = resolveSectionFields(
      section([
        { key: 'a', label: 'A', displayOrder: 2 },
        { key: 'b', label: 'B', displayOrder: 0 },
        { key: 'c', label: 'C', displayOrder: 1 },
      ]),
    );
    expect(result.map((f) => f.key)).toEqual(['b', 'c', 'a']);
  });

  it('mixes explicit and fallback displayOrder correctly', () => {
    const result = resolveSectionFields(
      section([
        { key: 'a', label: 'A' }, // falls back to index 0
        { key: 'b', label: 'B', displayOrder: -1 }, // explicitly first
      ]),
    );
    expect(result.map((f) => f.key)).toEqual(['b', 'a']);
  });
});
