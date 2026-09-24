import { describe, expect, it } from 'vitest';
import { normalizeTaskTextFields } from './textNormalization';

describe('normalizeTaskTextFields', () => {
  it('uppercases a lowercase task text', () => {
    expect(normalizeTaskTextFields({ text: 'call the family back' })).toEqual({ text: 'CALL THE FAMILY BACK' });
  });

  it('uppercases mixed-case text', () => {
    expect(normalizeTaskTextFields({ text: 'Call The Family' })).toEqual({ text: 'CALL THE FAMILY' });
  });

  it('leaves already-uppercase text unchanged (idempotent)', () => {
    expect(normalizeTaskTextFields({ text: 'CALL THE FAMILY' })).toEqual({ text: 'CALL THE FAMILY' });
  });

  it('leaves technical/non-string fields untouched', () => {
    const input = { text: 'follow up', isDone: false, assigneeStaffId: 'staff-1', dueDate: '2026-10-01', id: 'task-1' };
    const result = normalizeTaskTextFields(input);
    expect(result.isDone).toBe(false);
    expect(result.assigneeStaffId).toBe('staff-1');
    expect(result.dueDate).toBe('2026-10-01');
    expect(result.id).toBe('task-1');
  });

  it('leaves an absent text field absent', () => {
    const input: { text?: string; isDone: boolean } = { isDone: true };
    const result = normalizeTaskTextFields(input);
    expect('text' in result).toBe(false);
  });

  it('does not mutate the input (pure)', () => {
    const input = { text: 'lowercase' };
    normalizeTaskTextFields(input);
    expect(input.text).toBe('lowercase');
  });
});
