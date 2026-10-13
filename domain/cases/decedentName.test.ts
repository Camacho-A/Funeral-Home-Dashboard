import { describe, expect, it } from 'vitest';
import { composeDecedentName, shouldApplyIncomingMiddleName } from './decedentName';

describe('composeDecedentName', () => {
  it('inserts the middle name after the first name', () => {
    expect(composeDecedentName('JOYCE GOLLIS', 'BEVERLY')).toBe('JOYCE BEVERLY GOLLIS');
  });

  it('produces no extra spaces when there is no middle name', () => {
    for (const middle of [null, undefined, '', '   ']) {
      expect(composeDecedentName('JOYCE GOLLIS', middle), String(middle)).toBe('JOYCE GOLLIS');
    }
  });

  it('never re-splits a multi-word surname', () => {
    // The reason the stored name is left intact: no rule reliably tells a
    // compound surname from a middle name, and this organization has them.
    expect(composeDecedentName('EVARISTA SILVA RIVERO', 'MARIA')).toBe('EVARISTA MARIA SILVA RIVERO');
    expect(composeDecedentName('EVARISTA SILVA RIVERO', null)).toBe('EVARISTA SILVA RIVERO');
  });

  it('does not repeat a middle name already present in the stored name', () => {
    expect(composeDecedentName('JOYCE BEVERLY GOLLIS', 'BEVERLY')).toBe('JOYCE BEVERLY GOLLIS');
    expect(composeDecedentName('joyce beverly gollis', 'BEVERLY')).toBe('joyce beverly gollis');
  });

  it('matches whole tokens only — a short middle name is not "already present"', () => {
    expect(composeDecedentName('ANNABELLE SMITH', 'ANN')).toBe('ANNABELLE ANN SMITH');
  });

  it('handles a single-token stored name', () => {
    expect(composeDecedentName('GOLLIS', 'BEVERLY')).toBe('GOLLIS BEVERLY');
  });

  it('handles an empty stored name without leading space', () => {
    expect(composeDecedentName('', 'BEVERLY')).toBe('BEVERLY');
    expect(composeDecedentName('', '')).toBe('');
  });

  it('trims surrounding whitespace rather than embedding it', () => {
    expect(composeDecedentName('  JOYCE GOLLIS  ', '  BEVERLY  ')).toBe('JOYCE BEVERLY GOLLIS');
  });
});

describe('shouldApplyIncomingMiddleName', () => {
  it('never lets a blank form value erase a stored middle name', () => {
    // Forms re-send every field; an empty box means "not collected here",
    // not "delete what you have".
    for (const incoming of [null, undefined, '', '   ']) {
      expect(shouldApplyIncomingMiddleName('BEVERLY', incoming), String(incoming)).toBe(false);
    }
  });

  it('applies a real value when there is nothing stored', () => {
    expect(shouldApplyIncomingMiddleName(null, 'BEVERLY')).toBe(true);
    expect(shouldApplyIncomingMiddleName('', 'BEVERLY')).toBe(true);
  });

  it('applies a correction', () => {
    expect(shouldApplyIncomingMiddleName('BEVERLEY', 'BEVERLY')).toBe(true);
  });

  it('is a no-op when the value is unchanged', () => {
    expect(shouldApplyIncomingMiddleName('BEVERLY', 'BEVERLY')).toBe(false);
    expect(shouldApplyIncomingMiddleName('BEVERLY', '  BEVERLY  ')).toBe(false);
  });
});
